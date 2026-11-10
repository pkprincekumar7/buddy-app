"""common.generation.switch: the SSM kill switch for LLM generation (JOB-03)."""

import asyncio
from typing import Any

from common.generation.switch import GenerationSwitch

PARAM = "/superpower/prod/backend/us-east-1/llm_generation_enabled"


class FakeSsm:
    def __init__(self, *values: str | Exception) -> None:
        self.values = list(values)
        self.calls = 0

    def get_parameter(self, Name: str) -> dict[str, Any]:  # noqa: N803 - boto3's name
        assert Name == PARAM
        self.calls += 1
        value = self.values.pop(0) if len(self.values) > 1 else self.values[0]
        if isinstance(value, Exception):
            raise value
        return {"Parameter": {"Value": value}}


class Clock:
    def __init__(self) -> None:
        self.now = 0.0

    def __call__(self) -> float:
        return self.now


def _run(switch: GenerationSwitch) -> bool:
    return asyncio.run(switch.enabled())


def test_without_a_parameter_it_is_always_on():
    assert _run(GenerationSwitch.always_on())
    assert _run(GenerationSwitch(PARAM, None))  # no client: never reads


def test_false_turns_generation_off_and_true_back_on():
    ssm, clock = FakeSsm("false", " TRUE "), Clock()
    switch = GenerationSwitch(PARAM, ssm, clock=clock)
    assert not _run(switch)
    clock.now += 59
    assert not _run(switch) and ssm.calls == 1  # read at most once a minute
    clock.now += 1
    assert _run(switch) and ssm.calls == 2


def test_anything_but_false_is_on():
    for value in ("true", "yes", "on", ""):
        assert _run(GenerationSwitch(PARAM, FakeSsm(value)))


def test_an_unreadable_parameter_keeps_the_last_value(caplog):
    ssm, clock = FakeSsm(ConnectionError("no route"), "false", ConnectionError("no route")), Clock()
    switch = GenerationSwitch(PARAM, ssm, clock=clock)
    assert _run(switch)  # never read yet: on
    assert "unreadable" in caplog.text
    clock.now += 60
    assert not _run(switch)
    clock.now += 60
    assert not _run(switch)  # unreadable again: still off, as last read
    assert "is now off" in caplog.text
