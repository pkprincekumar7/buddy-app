"""Topics, queues and subscriptions, derived from the catalogue (docs/auth-users-split.md, 7.2).

- One topic per producing service: `{prefix}-{service}-events`.
- One queue per consuming service, `{prefix}-{service}-events`, with a DLQ after 5 receives.
- One subscription per (consumer, producer topic), filtered on `event_type` to the events the
  consumer takes from that topic, raw delivery off; the queue policy accepts messages only
  from those topics.

`plan()` is the shape modules/events (build plan 2.4) builds; `apply_local()` creates it in
local Moto (scripts/local-aws-setup.py).

    python -m common.events.topology --prefix superpower-dev    print the plan as JSON
"""

from __future__ import annotations

import argparse
import json
import sys
from typing import Any

from common.events import catalogue as catalogue_mod

MAX_RECEIVE_COUNT = 5


def topic_name(prefix: str, service: str) -> str:
    return f"{prefix}-{service}-events"


def queue_name(prefix: str, service: str) -> str:
    return f"{prefix}-{service}-events"


def dlq_name(prefix: str, service: str) -> str:
    return f"{prefix}-{service}-events-dlq"


def plan(prefix: str, catalogue: catalogue_mod.Catalogue | None = None) -> dict[str, Any]:
    cat = catalogue or catalogue_mod.load()
    return {
        "topics": {service: topic_name(prefix, service) for service in cat.producers()},
        "queues": {
            consumer: {
                "name": queue_name(prefix, consumer),
                "dlq": dlq_name(prefix, consumer),
                "max_receive_count": MAX_RECEIVE_COUNT,
                "subscriptions": cat.topics_for(consumer),
            }
            for consumer in cat.consumers()
        },
    }


def queue_policy(queue_arn: str, topic_arns: list[str]) -> str:
    return json.dumps(
        {
            "Version": "2012-10-17",
            "Statement": [
                {
                    "Effect": "Allow",
                    "Principal": {"Service": "sns.amazonaws.com"},
                    "Action": "sqs:SendMessage",
                    "Resource": queue_arn,
                    "Condition": {"ArnEquals": {"aws:SourceArn": sorted(topic_arns)}},
                }
            ],
        }
    )


def apply_local(sns: Any, sqs: Any, prefix: str) -> dict[str, dict[str, str]]:
    """Create the plan in Moto (or any SNS/SQS endpoint). Safe to re-run."""
    layout = plan(prefix)
    topics = {
        service: sns.create_topic(Name=name)["TopicArn"]
        for service, name in layout["topics"].items()
    }
    queues: dict[str, str] = {}
    for consumer, spec in layout["queues"].items():
        dlq_url = sqs.create_queue(QueueName=spec["dlq"])["QueueUrl"]
        dlq_arn = sqs.get_queue_attributes(QueueUrl=dlq_url, AttributeNames=["QueueArn"])[
            "Attributes"
        ]["QueueArn"]
        url = sqs.create_queue(QueueName=spec["name"])["QueueUrl"]
        arn = sqs.get_queue_attributes(QueueUrl=url, AttributeNames=["QueueArn"])["Attributes"][
            "QueueArn"
        ]
        sources = [topics[producer] for producer in spec["subscriptions"]]
        sqs.set_queue_attributes(
            QueueUrl=url,
            Attributes={
                "RedrivePolicy": json.dumps(
                    {
                        "deadLetterTargetArn": dlq_arn,
                        "maxReceiveCount": str(spec["max_receive_count"]),
                    }
                ),
                "Policy": queue_policy(arn, sources),
            },
        )
        for producer, event_types in spec["subscriptions"].items():
            sns.subscribe(
                TopicArn=topics[producer],
                Protocol="sqs",
                Endpoint=arn,
                Attributes={
                    "FilterPolicy": json.dumps({"event_type": event_types}),
                    "RawMessageDelivery": "false",
                },
            )
        queues[consumer] = url
    return {"topics": topics, "queues": queues}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Print the events topology as JSON.")
    parser.add_argument("--prefix", required=True, help="{app}-{env}, e.g. superpower-dev")
    args = parser.parse_args(argv)
    print(json.dumps(plan(args.prefix), indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":  # pragma: no cover - the CLI entry point; main() is tested
    sys.exit(main())
