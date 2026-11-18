# ---------------------------------------------------------------------------
# OpenTelemetry collector — shared, per environment per region (docs/auth-users-split.md, 15.5)
#
# Every runtime exports its spans over OTLP/HTTP to
# otel-collector.<app>-<env>.internal:4318 (Cloud Map), sampling 100% in the SDK.
# The collector decides what to keep (tail sampling): every trace with an error,
# every slow one, and xray_default_sampling_rate of the rest; it sends those to
# X-Ray. Scaling and alarm metrics don't pass through it, so losing it loses
# traces only.
#
# The ADOT image reads its whole configuration from AOT_CONFIG_CONTENT.
# ---------------------------------------------------------------------------

locals {
  otel_collector_config = yamlencode({
    extensions = {
      health_check = { endpoint = "0.0.0.0:13133" }
    }
    receivers = {
      otlp = { protocols = { http = { endpoint = "0.0.0.0:4318" } } }
    }
    processors = {
      # Hold each trace until it's complete, then decide.
      tail_sampling = {
        decision_wait = "10s"
        num_traces    = 50000
        policies = [
          { name = "errors", type = "status_code", status_code = { status_codes = ["ERROR"] } },
          { name = "slow", type = "latency", latency = { threshold_ms = 2000 } },
          { name = "baseline", type = "probabilistic", probabilistic = { sampling_percentage = var.xray_default_sampling_rate * 100 } },
        ]
      }
      batch = { timeout = "5s" }
    }
    exporters = {
      awsxray = { region = var.aws_region }
    }
    service = {
      extensions = ["health_check"]
      pipelines = {
        traces = {
          receivers  = ["otlp"]
          processors = ["tail_sampling", "batch"]
          exporters  = ["awsxray"]
        }
      }
    }
  })
}
