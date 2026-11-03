# ---------------------------------------------------------------------------
# CloudFront Response Headers Policy — frontend SPA
#
# Replaces the AWS-managed SecurityHeadersPolicy (which carries no CSP) with a
# custom policy that adds a Content-Security-Policy tailored to the app.
#
# CSP allow-list rationale:
#   script-src  'self' + accounts.google.com  — bundled React app served from S3;
#                                               Google Identity Services (GSI) script
#                                               loaded dynamically in Login.jsx.
#   style-src   'self' + 'unsafe-inline'       — Tailwind/shadcn bundled CSS (self);
#                + accounts.google.com          inline styles added by framer-motion
#                                               and shadcn components at runtime;
#                                               GSI button injects its own inline styles.
#   img-src     'self' + data: + blob:         — bundled and /app-assets/* images (self);
#                + the uploads buckets           generated avatars and FileReader previews
#                                               (data:); a picked photo's preview (blob:);
#                                               child photos, as presigned S3 URLs on each
#                                               region's uploads bucket. No other HTTPS host,
#                                               so a stored or injected URL elsewhere (a
#                                               tracking pixel) isn't loaded (APP-08).
#   font-src    'self' + data:                 — self-hosted fonts; base64-encoded fonts
#                                               bundled by Vite.
#   connect-src 'self' + accounts.google.com  — all /api/* calls proxied via CloudFront
#                + every active region's         to the ALB; Google OAuth token exchange.
#                  uploads bucket (global and   — presigned PUT for child avatar/90-day-plan
#                  regional S3 endpoint forms)    photo upload goes straight browser→S3,
#                                                  bypassing CloudFront entirely, so each
#                                                  region actually in use must be allow-listed
#                                                  here or its upload is blocked by the browser.
#                                                  boto3 may emit either endpoint form.
#   frame-src   accounts.google.com           — GSI "Sign in with Google" button renders
#                                               as a sandboxed iframe from Google.
#   frame-ancestors 'none'                    — prevent this SPA from being embedded in
#                                               any iframe (defence-in-depth alongside
#                                               X-Frame-Options: DENY).
#   base-uri    'self'                        — block <base> tag injection attacks.
#   form-action 'self'                        — form submissions must target same origin.
#   object-src  'none'                        — no Flash / legacy plug-ins.
# ---------------------------------------------------------------------------

locals {
  # One entry per active region's uploads bucket, on its regional endpoint —
  # the only form the backend's S3 client presigns (SigV4 + regional endpoint,
  # backend/common/uploads.py). The presigned form upload (POST) and the
  # presigned photo URLs go straight between the browser and S3, bypassing
  # CloudFront, so every active region must be allow-listed here (connect-src
  # for the upload, img-src for showing the photo) or the browser blocks it. Built from the bucket
  # names alone: no per-region provider or lookup needed (TF-01), so a new
  # region is just another key in var.uploads_bucket_names.
  uploads_connect_src_origins = [
    for region in var.backend_regions :
    "https://${var.uploads_bucket_names[region]}.s3.${region}.amazonaws.com"
  ]
}

resource "aws_cloudfront_response_headers_policy" "frontend_security" {
  name    = "${var.app_name}-frontend-security-${var.environment}"
  comment = "Security headers + CSP for the ${var.app_name} React SPA (${var.environment})"

  security_headers_config {
    # Block MIME-type sniffing — browser must honour the declared Content-Type.
    content_type_options {
      override = true
    }

    # Prevent the SPA from being framed (clickjacking defence).
    frame_options {
      frame_option = "DENY"
      override     = true
    }

    # Send only the origin (no path/query) as the referrer to third parties.
    referrer_policy {
      referrer_policy = "strict-origin-when-cross-origin"
      override        = true
    }

    # Enforce HTTPS for 2 years; opt in to browser preload lists.
    strict_transport_security {
      access_control_max_age_sec = 63072000
      include_subdomains         = true
      preload                    = true
      override                   = true
    }

    # Content Security Policy (see allow-list rationale above).
    content_security_policy {
      content_security_policy = join("; ", [
        "default-src 'self'",
        "script-src 'self' https://accounts.google.com",
        "style-src 'self' 'unsafe-inline' https://accounts.google.com",
        "img-src 'self' data: blob: ${join(" ", local.uploads_connect_src_origins)}",
        "font-src 'self' data:",
        "connect-src 'self' https://accounts.google.com ${join(" ", local.uploads_connect_src_origins)}",
        "frame-src https://accounts.google.com",
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "object-src 'none'",
      ])
      override = true
    }

    # Legacy XSS auditor — ignored by modern browsers but still expected by
    # some security scanners and older enterprise proxies.
    xss_protection {
      mode_block = true
      protection = true
      override   = true
    }
  }

  # Permissions-Policy is not available inside security_headers_config in the
  # AWS provider — it must be injected as a custom header.
  #
  # microphone=(self)   — VoiceInput.jsx calls getUserMedia({audio:true}) for
  #                       the audio transcription feature; must be allowed for
  #                       the same origin.
  # camera=()           — not used by the app; deny all.
  # geolocation=()      — not used; deny all.
  # payment=()          — not used; deny all.
  # usb=()              — not used; deny all.
  # interest-cohort=()  — opt out of FLoC / Topics API (Google interest tracking).
  custom_headers_config {
    items {
      header   = "Permissions-Policy"
      value    = "microphone=(self), camera=(), geolocation=(), payment=(), usb=(), interest-cohort=()"
      override = true
    }
  }
}

# ---------------------------------------------------------------------------
# Response headers policy for FastAPI API responses (/api/*)
#
# Sets the standard security headers that belong on every HTTPS response, and
# (via cors_config below) is the only source of CORS headers: the services
# send none (locally the apps call the API on their own origin, through a
# proxy). origin_override = true keeps it that way if one ever does.
#
# override = true on every security header too: CloudFront enforces the
# correct value regardless of what the origin returns, making this policy
# the single authoritative source for security headers on all /api/*
# responses.
# ---------------------------------------------------------------------------
resource "aws_cloudfront_response_headers_policy" "api_security" {
  name    = "${var.app_name}-api-security-${var.environment}"
  comment = "Security headers for FastAPI /api/* responses (${var.environment})"

  # The methods, headers and credentials the apps' API calls use.
  #
  # The allowed origin is local.fqdn (same "https://{fqdn}" value this module
  # already computes and outputs — see outputs.tf) — NOT a separate
  # cors_origins variable/secret. terraform-live-backend.yml derives its own
  # copy of this exact same value from SUBDOMAIN + DOMAIN_NAME + environment
  # (see its "Resolve derived values" step) rather than reading it from a
  # GitHub secret — there is no CORS_ORIGINS secret. Referencing local.fqdn
  # here means both modules compute the identical value from the same
  # primitives, with nothing new to keep in sync.
  cors_config {
    access_control_allow_credentials = true
    origin_override                  = true
    access_control_max_age_sec       = 600

    access_control_allow_origins {
      items = ["https://${local.fqdn}"]
    }

    access_control_allow_methods {
      items = ["GET", "POST", "PATCH", "DELETE", "OPTIONS"]
    }

    access_control_allow_headers {
      # X-Client-Location: sent only on /auth/register (see frontend/src/lib/locationHint.ts
      # and the jwt_validator Lambda@Edge's registration-routing hint) — without it here,
      # the browser's CORS preflight blocks the register call outright.
      items = ["Authorization", "Content-Type", "X-Request-Id", "X-Client-Location"]
    }

    access_control_expose_headers {
      items = []
    }
  }

  security_headers_config {
    # Block MIME-type sniffing on all API responses.
    content_type_options {
      override = true
    }

    # Prevent the API response from being loaded inside a frame.
    frame_options {
      frame_option = "DENY"
      override     = true
    }

    # Send only the origin (no path/query) as the referrer.
    referrer_policy {
      referrer_policy = "strict-origin-when-cross-origin"
      override        = true
    }

    # Enforce HTTPS for 2 years on this domain — applies to ALL HTTPS responses,
    # not just documents. HSTS must be set at the TLS-termination layer (CloudFront)
    # and is therefore absent from FastAPI's request_id_middleware.
    strict_transport_security {
      access_control_max_age_sec = 63072000
      include_subdomains         = true
      preload                    = true
      override                   = true
    }

    # Legacy XSS auditor header — ignored by modern browsers but still checked
    # by security scanners and older enterprise proxies.
    xss_protection {
      mode_block = true
      protection = true
      override   = true
    }
  }
}

# ---------------------------------------------------------------------------
# Minimal response headers policy for static assets (/app-assets/*)
#
# nosniff is essential for binary asset responses (images, fonts).
# HSTS must be set on ALL HTTPS responses — browsers honour it regardless of
# content type, updating their HSTS cache even for image or font responses.
# CSP, X-Frame-Options, Referrer-Policy and Permissions-Policy are
# document-level controls; browsers do not apply them to sub-resource responses
# so there is no security benefit in setting them on image/binary assets.
# ---------------------------------------------------------------------------
resource "aws_cloudfront_response_headers_policy" "assets" {
  name    = "${var.app_name}-assets-${var.environment}"
  comment = "Security headers for static asset responses (/app-assets/*) (${var.environment})"

  security_headers_config {
    content_type_options {
      override = true
    }

    # HSTS applies to all HTTPS responses — include it here so the browser's
    # HSTS cache is refreshed even when only asset requests are made.
    strict_transport_security {
      access_control_max_age_sec = 63072000
      include_subdomains         = true
      preload                    = true
      override                   = true
    }
  }
}
