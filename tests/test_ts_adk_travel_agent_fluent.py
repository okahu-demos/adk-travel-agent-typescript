import pytest
from monocle_test_tools import TraceAssertion


def test_flight_booking(monocle_trace_asserter: TraceAssertion):
    """Auto-generated test from trace analysis."""

    # Option 1: Load from a local trace file
    # monocle_trace_asserter.with_trace_source("file", trace_path="/var/folders/s4/tgps9wwn3rvc6215lnhq794m0000gn/T/monocle_trace_e2efd2c4f05613fa57ce2a8aa3165609.json")

    # Option 2: Load from Okahu
    monocle_trace_asserter.with_trace_source("okahu", id="e2efd2c4f05613fa57ce2a8aa3165609", workflow_name="adk-travel-agent-typescript")

    user_prompt = "book me a flight from bom to sfo"
    asserter = monocle_trace_asserter

    # Agent invocations with output checks
    asserter.called_agent("adk_flight_booking_agent").contains_input(user_prompt).contains_input("sfo")

    asserter.called_agent("adk_flight_booking_agent").contains_any_output("flight", "BOM", "SFO", "booked")
    asserter.called_agent("adk_flight_booking_agent").contains_output("Your flight from BOM to SFO has been booked.")


    asserter.called_agent("adk_hotel_booking_agent").contains_output("Your flight from BOM to SFO has been booked.")
    asserter.called_agent("adk_supervisor_agent").contains_output("Your flight from BOM to SFO has been booked.")
    asserter.called_agent("adk_trip_summary_agent").contains_output("Your flight from BOM to SFO has been booked.")

    # Tool invocations
    # asserter.called_tool("adk_book_flight", "adk_flight_booking_agent").contains_input("sfo").contains_input("bom").contains_output("Flight booked from bom to sfo").contains_output("Success")
    asserter.called_tool("adk_book_flight", "adk_flight_booking_agent")

    # Cost check: total tokens in the turn (derived from trace; adjust as needed)
    asserter.under_token_limit(1350)

    # Performance check: duration of the turn (derived from trace; adjust as needed)
    asserter.under_duration(5.7, units="seconds", span_type="agent_turn")

    # Eval assertions (require an eval service, e.g. Okahu)
    # eval discovery skipped: OKAHU_API_KEY not configured

    monocle_trace_asserter.with_evaluation("okahu").check_eval("frustration", expected="ok")
    # monocle_trace_asserter.with_evaluation("okahu").check_eval("sentiment", not_expected="negative")
    # monocle_trace_asserter.with_evaluation("okahu").check_eval("toxicity", not_expected="toxic")
    # monocle_trace_asserter.with_evaluation("okahu").check_eval(fact_name="inferences", eval_name="sentiment", not_expected="negative")
    # monocle_trace_asserter.with_evaluation("okahu").check_eval(fact_name="agentic_turns", eval_name="sentiment", not_expected="negative")
    # monocle_trace_asserter.with_evaluation("okahu").check_eval("hallucination", fact_name="agentic_sessions", expected="no_hallucination")
 