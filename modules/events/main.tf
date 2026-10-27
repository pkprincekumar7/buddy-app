# ---------------------------------------------------------------------------
# events — SNS + SQS for events between services (docs/auth-users-split.md, 7.2, 15.5)
#
# Everything comes from the event catalogue (backend/common/events/catalogue.json),
# the same file every service checks each message against, and the same plan as
# common.events.topology.plan():
#   - one SNS topic per producing service, "<app>-<env>-<service>-events": a service
#     publishes only to its own (its task role allows only that, 2.5);
#   - one SQS queue per consuming service, with a DLQ after max_receive_count;
#   - one subscription per (consumer, producer topic), filtered on the event_type
#     message attribute to the events the consumer takes from that topic, with raw
#     delivery OFF so the SNS envelope (and its TopicArn) reaches the consumer;
#   - a queue policy accepting sqs:SendMessage only from those topics, so nothing
#     can put a forged envelope straight into a queue;
#   - alarms on DLQ depth and on the age of the oldest message (15.5).
# Reserved events (no consumers yet) create nothing. user.data_deleted ("*") comes
# from every service in data_services. var.services limits all of it to the
# services a stack deploys (the catalogue also holds hello's demo event).
# ---------------------------------------------------------------------------

locals {
  catalogue = jsondecode(file(coalesce(var.catalogue_path, "${path.module}/../../backend/common/events/catalogue.json")))

  # Only the services this stack deploys (var.services; null = every one in the
  # catalogue): an event whose producer or every consumer isn't deployed creates
  # nothing, and consumers that aren't deployed are dropped.
  all_services  = var.services == null
  deployed      = toset(coalesce(var.services, []))
  data_services = local.all_services ? toset(local.catalogue.data_services) : setintersection(toset(local.catalogue.data_services), local.deployed)
  candidates = {
    for name, e in local.catalogue.events : name => merge(e, {
      consumers = [for c in e.consumers : c if local.all_services || contains(local.deployed, c)]
    }) if !lookup(e, "reserved", false) && (e.producer == "*" || local.all_services || contains(local.deployed, e.producer))
  }
  published = { for name, e in local.candidates : name => e if length(e.consumers) > 0 }
  # Event type → the services whose topics carry it.
  sources = {
    for name, e in local.published : name => (e.producer == "*" ? sort(tolist(local.data_services)) : [e.producer])
  }

  producers = toset(flatten(values(local.sources)))
  consumers = toset(flatten([for e in values(local.published) : e.consumers]))

  # "<consumer>:<producer>" → the event types the consumer takes from that topic.
  subscriptions = {
    for pair in distinct(flatten([
      for name, e in local.published : [
        for c in e.consumers : [for p in local.sources[name] : "${c}:${p}"]
      ]
    ])) :
    pair => {
      consumer = split(":", pair)[0]
      producer = split(":", pair)[1]
      event_types = sort([
        for name, e in local.published : name
        if contains(e.consumers, split(":", pair)[0]) && contains(local.sources[name], split(":", pair)[1])
      ])
    }
  }

  prefix = "${var.app_name}-${var.environment}"
}

# ── encryption ─────────────────────────────────────────────────────────────────

# Events carry personal data (child.changed has the child's name and age), so the
# topics use a customer-managed key: its use is logged and limited by its policy.
# One per environment and region (about $1 a month). Publishers need
# kms:GenerateDataKey and kms:Decrypt on it in their task roles (2.5, key_arn).
data "aws_caller_identity" "current" {}

data "aws_iam_policy_document" "events_key" {
  #checkov:skip=CKV_AWS_109:A KMS key policy's Resource "*" means this key only; the account-root statement is AWS's default key policy, so IAM policies (the task roles, 2.5) decide who uses it
  #checkov:skip=CKV_AWS_111:As above: in a key policy, "*" is the key the policy is attached to, not every resource
  #checkov:skip=CKV_AWS_356:As above: a key policy can only name its own key, which it does with "*"
  statement {
    sid       = "AccountAdministers"
    effect    = "Allow"
    actions   = ["kms:*"]
    resources = ["*"]

    principals {
      type        = "AWS"
      identifiers = ["arn:aws:iam::${data.aws_caller_identity.current.account_id}:root"]
    }
  }

  # SNS encrypts and decrypts messages for this account's topics, to deliver them
  # to the (SSE-SQS) queues.
  statement {
    sid       = "SnsUsesTheKeyForThisAccount"
    effect    = "Allow"
    actions   = ["kms:GenerateDataKey*", "kms:Decrypt"]
    resources = ["*"]

    principals {
      type        = "Service"
      identifiers = ["sns.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }
  }
}

resource "aws_kms_key" "events" {
  description             = "${local.prefix} events: SNS topic encryption"
  enable_key_rotation     = true
  deletion_window_in_days = 7
  policy                  = data.aws_iam_policy_document.events_key.json

  tags = {
    Name = "${local.prefix}-events"
  }
}

resource "aws_kms_alias" "events" {
  name          = "alias/${local.prefix}-events"
  target_key_id = aws_kms_key.events.key_id
}

# ── topics ─────────────────────────────────────────────────────────────────────

resource "aws_sns_topic" "producer" {
  for_each = local.producers

  name              = "${local.prefix}-${each.key}-events"
  kms_master_key_id = aws_kms_key.events.arn

  tags = {
    Name    = "${local.prefix}-${each.key}-events"
    Service = each.key
  }
}

# ── queues ─────────────────────────────────────────────────────────────────────

resource "aws_sqs_queue" "dlq" {
  for_each = local.consumers

  name                      = "${local.prefix}-${each.key}-events-dlq"
  message_retention_seconds = 1209600 # 14 days, to investigate and redrive
  sqs_managed_sse_enabled   = true

  tags = {
    Name    = "${local.prefix}-${each.key}-events-dlq"
    Service = each.key
  }
}

# SSE-SQS rather than KMS: SNS can deliver into an SSE-SQS queue without a
# customer-managed key policy.
resource "aws_sqs_queue" "consumer" {
  for_each = local.consumers

  name                       = "${local.prefix}-${each.key}-events"
  visibility_timeout_seconds = var.queue_visibility_timeout_seconds
  message_retention_seconds  = var.queue_retention_seconds
  receive_wait_time_seconds  = 20 # long polling, as the consumer does
  sqs_managed_sse_enabled    = true

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.dlq[each.key].arn
    maxReceiveCount     = var.max_receive_count
  })

  tags = {
    Name    = "${local.prefix}-${each.key}-events"
    Service = each.key
  }
}

# Only the consumer's own queue may redrive into its DLQ.
resource "aws_sqs_queue_redrive_allow_policy" "dlq" {
  for_each = local.consumers

  queue_url = aws_sqs_queue.dlq[each.key].id
  redrive_allow_policy = jsonencode({
    redrivePermission = "byQueue"
    sourceQueueArns   = [aws_sqs_queue.consumer[each.key].arn]
  })
}

data "aws_iam_policy_document" "queue" {
  for_each = local.consumers

  statement {
    sid       = "OnlyFromSubscribedTopics"
    effect    = "Allow"
    actions   = ["sqs:SendMessage"]
    resources = [aws_sqs_queue.consumer[each.key].arn]

    principals {
      type        = "Service"
      identifiers = ["sns.amazonaws.com"]
    }

    condition {
      test     = "ArnEquals"
      variable = "aws:SourceArn"
      values   = sort([for k, s in local.subscriptions : aws_sns_topic.producer[s.producer].arn if s.consumer == each.key])
    }
  }
}

resource "aws_sqs_queue_policy" "consumer" {
  for_each = local.consumers

  queue_url = aws_sqs_queue.consumer[each.key].id
  policy    = data.aws_iam_policy_document.queue[each.key].json
}

# ── subscriptions ──────────────────────────────────────────────────────────────

resource "aws_sns_topic_subscription" "consumer" {
  for_each = local.subscriptions

  topic_arn = aws_sns_topic.producer[each.value.producer].arn
  protocol  = "sqs"
  endpoint  = aws_sqs_queue.consumer[each.value.consumer].arn

  # Off, so the consumer receives the SNS envelope with TopicArn (7.2).
  raw_message_delivery = false
  filter_policy_scope  = "MessageAttributes"
  filter_policy        = jsonencode({ event_type = each.value.event_types })

  # The queue policy must exist first, or SNS can't deliver the confirmation.
  depends_on = [aws_sqs_queue_policy.consumer]
}

# ── alarms (15.5) ──────────────────────────────────────────────────────────────

# Anything in a DLQ means a message failed max_receive_count times, or was
# rejected (wrong topic, bad payload): look at it.
resource "aws_cloudwatch_metric_alarm" "dlq_depth" {
  for_each = var.enable_alarms ? local.consumers : toset([])

  alarm_name          = "${local.prefix}-${each.key}-events-dlq-depth"
  alarm_description   = "Messages in ${each.key}'s events DLQ: failed or rejected events to investigate (docs/auth-users-split.md 7.2)."
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateNumberOfMessagesVisible"
  dimensions          = { QueueName = aws_sqs_queue.dlq[each.key].name }
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  # An idle queue stops reporting after 6 hours; no data is not a problem (15.5).
  treat_missing_data = "notBreaching"
  alarm_actions      = [var.alarm_topic_arn]
  ok_actions         = [var.alarm_topic_arn]

  lifecycle {
    precondition {
      condition     = var.alarm_topic_arn != null
      error_message = "enable_alarms needs alarm_topic_arn."
    }
  }
}

# A message waiting this long means the consumer is down or stuck.
resource "aws_cloudwatch_metric_alarm" "oldest_message_age" {
  for_each = var.enable_alarms ? local.consumers : toset([])

  alarm_name          = "${local.prefix}-${each.key}-events-oldest-message"
  alarm_description   = "${each.key}'s events queue has a message older than ${var.oldest_message_age_threshold_seconds} s: its consumer is down or stuck (docs/auth-users-split.md 15.5)."
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateAgeOfOldestMessage"
  dimensions          = { QueueName = aws_sqs_queue.consumer[each.key].name }
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 2
  threshold           = var.oldest_message_age_threshold_seconds
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [var.alarm_topic_arn]
  ok_actions          = [var.alarm_topic_arn]

  lifecycle {
    precondition {
      condition     = var.alarm_topic_arn != null
      error_message = "enable_alarms needs alarm_topic_arn."
    }
  }
}
