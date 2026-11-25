"""Aprobación humana: solo SÍ explícito autoriza la ejecución."""

from src.approval import approved, ask_human_approval, declined, parse_answer


def test_only_yes_tokens_approve():
    for answer in ("y", "Y", "yes", " YES "):
        assert parse_answer(answer).approved is True, answer
    for answer in ("", "n", "N", "no", "maybe", "1", "true"):
        assert parse_answer(answer).approved is False, answer


def test_eof_is_a_decline(monkeypatch, capsys):
    monkeypatch.setattr("builtins.input", lambda _: (_ for _ in ()).throw(EOFError()))
    decision = ask_human_approval("resumen público")
    assert decision.approved is False
    captured = capsys.readouterr()
    assert "resumen público" in captured.out


def test_human_answer_drives_decision(monkeypatch):
    monkeypatch.setattr("builtins.input", lambda _: "y")
    assert ask_human_approval("resumen").approved is True
    monkeypatch.setattr("builtins.input", lambda _: "n")
    assert ask_human_approval("resumen").approved is False


def test_injected_helpers():
    assert approved().approved is True
    assert approved().source == "injected-approved"
    assert declined().approved is False
    assert declined("test").source == "test"
