# terraform test — mock AWS provider: no credentials, nothing is created.
# Run from modules/events: terraform init && terraform test
#
# The module reads the real catalogue (backend/common/events/catalogue.json), so these
# assertions are the same facts common's tests check for common.events.topology.plan().

mock_provider "aws" {
  mock_data "aws_iam_policy_document" {
    defaults = {
      json = "{\"Version\":\"2012-10-17\",\"Statement\":[]}"
    }
  }
  # Valid ARNs for the resources whose ARNs other resources check.
  mock_resource "aws_sns_topic" {
    defaults = { arn = "arn:aws:sns:ap-south-1:111111111111:mock-events" }
  }
  mock_resource "aws_kms_key" {
    defaults = { arn = "arn:aws:kms:ap-south-1:111111111111:key/00000000-0000-0000-0000-000000000000", key_id = "00000000-0000-0000-0000-000000000000" }
  }
  mock_data "aws_caller_identity" {
    defaults = { account_id = "111111111111" }
  }
  mock_resource "aws_sqs_queue" {
    defaults = { arn = "arn:aws:sqs:ap-south-1:111111111111:mock-events" }
  }
}

# Distinct ARNs per service, so the assertions can tell the topics and queues apart.

override_resource {
  target = aws_sns_topic.producer["auth"]
  values = { arn = "arn:aws:sns:ap-south-1:111111111111:superpower-prod-auth-events" }
}
override_resource {
  target = aws_sqs_queue.consumer["auth"]
  values = { arn = "arn:aws:sqs:ap-south-1:111111111111:superpower-prod-auth-events", id = "https://sqs.ap-south-1.amazonaws.com/111111111111/superpower-prod-auth-events" }
}

override_resource {
  target = aws_sns_topic.producer["children"]
  values = { arn = "arn:aws:sns:ap-south-1:111111111111:superpower-prod-children-events" }
}
override_resource {
  target = aws_sqs_queue.consumer["children"]
  values = { arn = "arn:aws:sqs:ap-south-1:111111111111:superpower-prod-children-events", id = "https://sqs.ap-south-1.amazonaws.com/111111111111/superpower-prod-children-events" }
}

override_resource {
  target = aws_sns_topic.producer["discover"]
  values = { arn = "arn:aws:sns:ap-south-1:111111111111:superpower-prod-discover-events" }
}
override_resource {
  target = aws_sqs_queue.consumer["discover"]
  values = { arn = "arn:aws:sqs:ap-south-1:111111111111:superpower-prod-discover-events", id = "https://sqs.ap-south-1.amazonaws.com/111111111111/superpower-prod-discover-events" }
}

override_resource {
  target = aws_sns_topic.producer["grow"]
  values = { arn = "arn:aws:sns:ap-south-1:111111111111:superpower-prod-grow-events" }
}
override_resource {
  target = aws_sqs_queue.consumer["grow"]
  values = { arn = "arn:aws:sqs:ap-south-1:111111111111:superpower-prod-grow-events", id = "https://sqs.ap-south-1.amazonaws.com/111111111111/superpower-prod-grow-events" }
}

override_resource {
  target = aws_sns_topic.producer["hello"]
  values = { arn = "arn:aws:sns:ap-south-1:111111111111:superpower-prod-hello-events" }
}
override_resource {
  target = aws_sqs_queue.consumer["hello"]
  values = { arn = "arn:aws:sqs:ap-south-1:111111111111:superpower-prod-hello-events", id = "https://sqs.ap-south-1.amazonaws.com/111111111111/superpower-prod-hello-events" }
}

override_resource {
  target = aws_sns_topic.producer["onboarding"]
  values = { arn = "arn:aws:sns:ap-south-1:111111111111:superpower-prod-onboarding-events" }
}
override_resource {
  target = aws_sqs_queue.consumer["onboarding"]
  values = { arn = "arn:aws:sqs:ap-south-1:111111111111:superpower-prod-onboarding-events", id = "https://sqs.ap-south-1.amazonaws.com/111111111111/superpower-prod-onboarding-events" }
}

override_resource {
  target = aws_sns_topic.producer["release"]
  values = { arn = "arn:aws:sns:ap-south-1:111111111111:superpower-prod-release-events" }
}
override_resource {
  target = aws_sqs_queue.consumer["release"]
  values = { arn = "arn:aws:sqs:ap-south-1:111111111111:superpower-prod-release-events", id = "https://sqs.ap-south-1.amazonaws.com/111111111111/superpower-prod-release-events" }
}

override_resource {
  target = aws_sns_topic.producer["transform"]
  values = { arn = "arn:aws:sns:ap-south-1:111111111111:superpower-prod-transform-events" }
}
override_resource {
  target = aws_sqs_queue.consumer["transform"]
  values = { arn = "arn:aws:sqs:ap-south-1:111111111111:superpower-prod-transform-events", id = "https://sqs.ap-south-1.amazonaws.com/111111111111/superpower-prod-transform-events" }
}

override_resource {
  target = aws_sns_topic.producer["users"]
  values = { arn = "arn:aws:sns:ap-south-1:111111111111:superpower-prod-users-events" }
}
override_resource {
  target = aws_sqs_queue.consumer["users"]
  values = { arn = "arn:aws:sqs:ap-south-1:111111111111:superpower-prod-users-events", id = "https://sqs.ap-south-1.amazonaws.com/111111111111/superpower-prod-users-events" }
}

variables {
  app_name    = "superpower"
  environment = "prod"
}

run "topics_queues_and_subscriptions_from_the_catalogue" {
  command = apply

  assert {
    condition = keys(aws_sns_topic.producer) == [
      "auth", "children", "discover", "grow", "hello", "onboarding", "release", "transform", "users",
    ]
    error_message = "One topic per producing service (7.2); connect isn't built."
  }
  assert {
    condition     = aws_sns_topic.producer["grow"].name == "superpower-prod-grow-events" && aws_sns_topic.producer["grow"].kms_master_key_id == aws_kms_key.events.arn && aws_kms_key.events.enable_key_rotation
    error_message = "Topics are <app>-<env>-<service>-events, encrypted with the environment's rotating customer-managed key."
  }
  assert {
    condition = keys(aws_sqs_queue.consumer) == [
      "auth", "children", "discover", "grow", "hello", "onboarding", "release", "transform", "users",
    ]
    error_message = "One queue per consuming service."
  }
  assert {
    condition = (
      aws_sqs_queue.consumer["grow"].name == "superpower-prod-grow-events"
      && aws_sqs_queue.dlq["grow"].name == "superpower-prod-grow-events-dlq"
      && aws_sqs_queue.consumer["grow"].sqs_managed_sse_enabled
      && aws_sqs_queue.dlq["grow"].message_retention_seconds == 1209600
      && aws_sqs_queue.consumer["grow"].receive_wait_time_seconds == 20
    )
    error_message = "Queue and DLQ names, SSE-SQS, 14-day DLQ retention, long polling."
  }
  assert {
    condition     = jsondecode(aws_sqs_queue.consumer["grow"].redrive_policy).maxReceiveCount == 5 && jsondecode(aws_sqs_queue.consumer["grow"].redrive_policy).deadLetterTargetArn == aws_sqs_queue.dlq["grow"].arn
    error_message = "A message moves to the service's own DLQ after 5 receives."
  }
  assert {
    condition = (
      output.subscriptions["grow:discover"] == tolist(["discover.personality_finalised"])
      && output.subscriptions["grow:children"] == tolist(["child.changed", "child.deleted"])
      && output.subscriptions["grow:onboarding"] == tolist(["onboarding.answers_updated", "onboarding.conversation_completed"])
      && output.subscriptions["grow:auth"] == tolist(["user.deletion_requested"])
    )
    error_message = "Each subscription takes only the events the consumer subscribes to from that topic."
  }
  assert {
    condition = alltrue([
      for p in ["users", "children", "onboarding", "discover", "grow", "transform", "release"] : output.subscriptions["auth:${p}"] == tolist(["user.data_deleted"])
    ]) && !contains(keys(output.subscriptions), "auth:hello")
    error_message = "auth hears user.data_deleted from every service holding user data, and nothing else (7.2)."
  }
  assert {
    condition     = !contains(keys(output.subscriptions), "children:children") && output.subscriptions["hello:hello"] == tolist(["hello.pinged"])
    error_message = "No service hears its own events unless it subscribes to them (hello's demo does)."
  }
  assert {
    condition     = length(aws_sns_topic_subscription.consumer) == length(output.subscriptions)
    error_message = "One SNS subscription per (consumer, producer topic) pair in the catalogue."
  }
  assert {
    condition = alltrue([
      for s in values(aws_sns_topic_subscription.consumer) : s.protocol == "sqs" && !s.raw_message_delivery && s.filter_policy_scope == "MessageAttributes"
    ])
    error_message = "Raw delivery off, so the SNS envelope and its TopicArn reach the consumer (7.2)."
  }
  assert {
    condition = (
      jsondecode(aws_sns_topic_subscription.consumer["grow:discover"].filter_policy) == { event_type = ["discover.personality_finalised"] }
      && aws_sns_topic_subscription.consumer["grow:discover"].topic_arn == aws_sns_topic.producer["discover"].arn
      && aws_sns_topic_subscription.consumer["grow:discover"].endpoint == aws_sqs_queue.consumer["grow"].arn
    )
    error_message = "The filter policy is on event_type, from the producer's topic to the consumer's queue."
  }
  assert {
    condition = (
      one(one(data.aws_iam_policy_document.queue["grow"].statement).principals).identifiers == toset(["sns.amazonaws.com"])
      && one(data.aws_iam_policy_document.queue["grow"].statement).actions == toset(["sqs:SendMessage"])
      && toset(one(one(data.aws_iam_policy_document.queue["grow"].statement).condition).values) == toset([
        for p in ["auth", "children", "discover", "onboarding"] : aws_sns_topic.producer[p].arn
      ])
    )
    error_message = "Each queue accepts SendMessage only from the topics it's subscribed to."
  }
  assert {
    condition     = jsondecode(aws_sqs_queue_redrive_allow_policy.dlq["grow"].redrive_allow_policy) == { redrivePermission = "byQueue", sourceQueueArns = [aws_sqs_queue.consumer["grow"].arn] }
    error_message = "Only the service's own queue redrives into its DLQ."
  }
  assert {
    condition     = length(aws_cloudwatch_metric_alarm.dlq_depth) == 0 && length(aws_cloudwatch_metric_alarm.oldest_message_age) == 0
    error_message = "No alarms unless enabled."
  }
  assert {
    condition     = output.prefix == "superpower-prod" && output.topic_arns["grow"] == aws_sns_topic.producer["grow"].arn && output.queue_urls["grow"] == aws_sqs_queue.consumer["grow"].id
    error_message = "The topic and queue each service is configured with."
  }
}

run "alarms_on_dlq_depth_and_message_age" {
  command = apply

  variables {
    enable_alarms   = true
    alarm_topic_arn = "arn:aws:sns:ap-south-1:111111111111:alerts"
  }

  assert {
    condition = (
      aws_cloudwatch_metric_alarm.dlq_depth["grow"].metric_name == "ApproximateNumberOfMessagesVisible"
      && aws_cloudwatch_metric_alarm.dlq_depth["grow"].dimensions.QueueName == "superpower-prod-grow-events-dlq"
      && aws_cloudwatch_metric_alarm.dlq_depth["grow"].threshold == 0
    )
    error_message = "Anything in a DLQ alarms."
  }
  assert {
    condition = (
      aws_cloudwatch_metric_alarm.oldest_message_age["grow"].metric_name == "ApproximateAgeOfOldestMessage"
      && aws_cloudwatch_metric_alarm.oldest_message_age["grow"].dimensions.QueueName == "superpower-prod-grow-events"
      && aws_cloudwatch_metric_alarm.oldest_message_age["grow"].threshold == 600
    )
    error_message = "A message waiting over 10 minutes alarms: the consumer is down."
  }
  assert {
    condition = alltrue([
      for a in concat(values(aws_cloudwatch_metric_alarm.dlq_depth), values(aws_cloudwatch_metric_alarm.oldest_message_age)) : a.treat_missing_data == "notBreaching"
    ])
    error_message = "An idle queue stops reporting: missing data isn't an alarm (15.5)."
  }
  assert {
    condition     = length(aws_cloudwatch_metric_alarm.dlq_depth) == 9 && length(aws_cloudwatch_metric_alarm.oldest_message_age) == 9
    error_message = "Both alarms on every consumer."
  }
}

run "alarms_need_a_topic" {
  command = plan

  variables {
    enable_alarms = true
  }

  expect_failures = [aws_cloudwatch_metric_alarm.dlq_depth, aws_cloudwatch_metric_alarm.oldest_message_age]
}

run "reserved_events_create_nothing" {
  command = plan

  variables {
    catalogue_path = "tests/fixtures/reserved_only.json"
  }

  assert {
    condition     = length(aws_sns_topic.producer) == 1 && length(aws_sqs_queue.consumer) == 1 && keys(output.subscriptions) == ["children:discover"]
    error_message = "Only the published event gets a topic, queue and subscription; reserved ones none."
  }
}

run "only_the_deployed_services" {
  # A stack passes the services it deploys: hello's demo event and the
  # consumers it doesn't run create nothing.
  command = plan

  variables {
    services = ["auth", "users", "children"]
  }

  assert {
    condition     = keys(aws_sns_topic.producer) == ["auth", "children", "users"] && keys(aws_sqs_queue.consumer) == ["auth", "children", "users"]
    error_message = "Topics and queues only for the deployed services."
  }
  assert {
    condition     = output.subscriptions == { "auth:children" = tolist(["user.data_deleted"]), "auth:users" = tolist(["user.data_deleted"]), "children:auth" = tolist(["user.deletion_requested"]), "users:auth" = tolist(["user.deletion_requested"]) }
    error_message = "Subscriptions only between deployed services; user.data_deleted only from the deployed data services."
  }
}

run "queue_settings_are_bounded" {
  command = plan

  variables {
    max_receive_count = 0
  }

  expect_failures = [var.max_receive_count]
}
