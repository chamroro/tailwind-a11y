import pytest

from a11y_evals.extract import extract_code
from a11y_evals.models import RunStatus

CODE = "export const A = () => <p>hi</p>;"


def fence(body, lang="tsx"):
    return f"```{lang}\n{body}\n```"


def test_one_block_is_scored():
    assert extract_code(f"intro\n{fence(CODE)}\noutro") == (RunStatus.SCORED, CODE)


@pytest.mark.parametrize("lang", ["", "jsx", "ts", "typescript", "js", "javascript", "TSX"])
def test_accepted_language_tags(lang):
    assert extract_code(fence(CODE, lang))[0] == RunStatus.SCORED


@pytest.mark.parametrize("lang", ["bash", "css", "json", "html"])
def test_other_languages_are_not_the_component(lang):
    assert extract_code(fence("x", lang))[0] == RunStatus.NO_CODE_BLOCK


def test_several_blocks_use_the_last_and_say_so():
    raw = fence("export const first = <b />;") + "\ntext\n" + fence(CODE)
    assert extract_code(raw) == (RunStatus.MULTIPLE_BLOCKS, CODE)


def test_a_non_component_block_after_the_component_does_not_replace_it():
    raw = fence(CODE) + "\n" + fence("npm i x", "bash")
    assert extract_code(raw) == (RunStatus.SCORED, CODE)


def test_unclosed_fence_is_not_a_block():
    assert extract_code("```tsx\n" + CODE)[0] == RunStatus.NO_CODE_BLOCK


def test_unclosed_fence_after_max_tokens_is_truncated():
    assert extract_code("```tsx\n" + CODE, "max_tokens")[0] == RunStatus.TRUNCATED
    assert extract_code("```tsx\n" + CODE, "length")[0] == RunStatus.TRUNCATED


def test_prose_only():
    assert extract_code("Sure, I would use a flex container.")[0] == RunStatus.NO_CODE_BLOCK


@pytest.mark.parametrize("raw", ["", "   \n ", None])
def test_empty(raw):
    assert extract_code(raw) == (RunStatus.EMPTY, None)


def test_empty_block_is_not_code():
    assert extract_code("```tsx\n\n```")[0] == RunStatus.NO_CODE_BLOCK


def test_fence_inside_a_string_does_not_end_the_block():
    code = 'export const s = "```";\nexport const A = () => <p />;'
    status, got = extract_code(fence(code))
    assert status == RunStatus.SCORED and got == code


def test_a_complete_block_wins_over_truncation_flag():
    assert extract_code(fence(CODE), "max_tokens")[0] == RunStatus.SCORED


def test_same_rule_whatever_the_arm_text():
    # The rule only sees the answer; there is nothing arm-specific to differ.
    a = extract_code(fence(CODE))
    b = extract_code(fence(CODE))
    assert a == b


def test_windows_line_endings():
    assert extract_code("```tsx\r\n" + CODE + "\r\n```\r\n") == (RunStatus.SCORED, CODE)


def test_attributes_after_the_language_are_allowed():
    assert extract_code(f"```tsx title=App.tsx\n{CODE}\n```") == (RunStatus.SCORED, CODE)


def test_two_titled_blocks_are_two_blocks_not_one_garbled_one():
    first, second = "export const a = <b />;", CODE
    status, code = extract_code(f"```tsx title=A.tsx\n{first}\n```\ntext\n```tsx title=B.tsx\n{second}\n```")
    assert (status, code) == (RunStatus.MULTIPLE_BLOCKS, second)


def test_a_fence_indented_up_to_three_spaces_is_a_fence():
    assert extract_code(f"  ```tsx\n{CODE}\n  ```")[0] == RunStatus.SCORED


def test_a_trailing_usage_snippet_does_not_replace_the_component():
    usage = 'import { A } from "./A";'
    status, code = extract_code(fence(CODE) + "\nUse it like this:\n" + fence(usage, "ts"))
    assert (status, code) == (RunStatus.MULTIPLE_BLOCKS, CODE)


def test_when_no_block_has_jsx_the_last_is_used():
    assert extract_code(fence("export const a = 1;") + "\n" + fence("export const b = 2;")) == (RunStatus.MULTIPLE_BLOCKS, "export const b = 2;")


def test_a_closed_draft_followed_by_a_cut_off_answer_is_truncated():
    raw = fence(CODE) + "\nActually, here is a better version:\n```tsx\nexport const B = () => <d"
    assert extract_code(raw, "max_tokens")[0] == RunStatus.TRUNCATED
    # the same text without a token-limit stop is the draft, scored
    assert extract_code(raw, "end_turn")[0] == RunStatus.SCORED
