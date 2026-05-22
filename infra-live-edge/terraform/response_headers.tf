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
#   img-src     'self' + data: + https:         — bundled SVG/PNG assets; base64 data URIs;
#                                               all HTTPS image sources including S3-backed
#                                               activity-game images (served via CloudFront
#                                               /app-assets/*) and Google profile photos.
#   font-src    'self' + data:                 — self-hosted fonts; base64-encoded fonts
#                                               bundled by Vite.
#   connect-src 'self' + accounts.google.com  — all /api/* calls proxied via CloudFront
#                                               to the ALB; Google OAuth token exchange.
#   frame-src   accounts.google.com           — GSI "Sign in with Google" button renders
#                                               as a sandboxed iframe from Google.
#   frame-ancestors 'none'                    — prevent this SPA from being embedded in
#                                               any iframe (defence-in-depth alongside
#                                               X-Frame-Options: DENY).
#   base-uri    'self'                        — block <base> tag injection attacks.
#   form-action 'self'                        — form submissions must target same origin.
#   object-src  'none'                        — no Flash / legacy plug-ins.
# ---------------------------------------------------------------------------

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
        "img-src 'self' data: https:",
        "font-src 'self' data:",
        "connect-src 'self' https://accounts.google.com",
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
# Sets the standard security headers that belong on every HTTPS response.
# CORS headers (Access-Control-*) are intentionally omitted — FastAPI's
# CORSMiddleware is the single authoritative source for those and they pass
# through CloudFront unchanged. Adding them here would create duplicates.
#
# override = true on every header: CloudFront enforces the correct value
# regardless of what the origin returns, making this policy the single
# authoritative source for security headers on all /api/* responses.
# ---------------------------------------------------------------------------
resource "aws_cloudfront_response_headers_policy" "api_security" {
  name    = "${var.app_name}-api-security-${var.environment}"
  comment = "Security headers for FastAPI /api/* responses (${var.environment})"

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
