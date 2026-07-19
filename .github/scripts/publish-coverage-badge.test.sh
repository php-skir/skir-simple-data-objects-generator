#!/usr/bin/env bash

set -euo pipefail

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
publisher="$script_dir/publish-coverage-badge.sh"
test_dir=$(mktemp -d)
trap 'rm -rf -- "$test_dir"' EXIT

badge_path="$test_dir/coverage.svg"
mock_log="$test_dir/gh.log"
printf '<svg>coverage</svg>' > "$badge_path"
: > "$mock_log"

gh() {
    local arguments="$*"

    if [[ "$arguments" == *'git/ref/heads/main'* ]]; then
        printf '%s\n' "$MOCK_MAIN_SHA"
        return 0
    fi

    if [[ "$arguments" == *'git/ref/heads/badges'* ]]; then
        return 0
    fi

    if [[ "$arguments" == *'--method POST'* || "$arguments" == *'--method PUT'* ]]; then
        printf '%s|%s\n' "$MOCK_SCENARIO" "$arguments" >> "$MOCK_GH_LOG"
        return 0
    fi

    if [[ "$arguments" == *'contents/coverage.svg'* && "$arguments" == *'.content'* ]]; then
        if [[ "$MOCK_SCENARIO" == 'update' ]]; then
            printf 'different-content\n'
            return 0
        fi

        return 1
    fi

    if [[ "$arguments" == *'contents/coverage.svg'* && "$arguments" == *'.sha'* ]]; then
        if [[ "$MOCK_SCENARIO" == 'update' ]]; then
            printf 'existing-badge-sha\n'
            return 0
        fi

        return 1
    fi

    return 1
}

export -f gh
export GITHUB_REPOSITORY='php-skir/skir-simple-data-objects-generator'
export MOCK_GH_LOG="$mock_log"
export MOCK_MAIN_SHA='latest-main-sha'

export GITHUB_SHA='older-main-sha'
export MOCK_SCENARIO='stale'
bash "$publisher" "$badge_path"

if [[ -s "$mock_log" ]]; then
    echo 'A stale workflow run attempted to mutate the badge branch.' >&2
    exit 1
fi

export GITHUB_SHA='latest-main-sha'
export MOCK_SCENARIO='update'
bash "$publisher" "$badge_path"

if [[ $(wc -l < "$mock_log") -ne 1 ]]; then
    echo 'The current workflow did not update the existing badge exactly once.' >&2
    exit 1
fi

if ! grep -q -- '--method PUT .*message=Update coverage badge.*sha=existing-badge-sha' "$mock_log"; then
    echo 'The existing badge update did not use its current blob SHA.' >&2
    exit 1
fi

: > "$mock_log"
export MOCK_SCENARIO='create'
bash "$publisher" "$badge_path"

if [[ $(wc -l < "$mock_log") -ne 1 ]]; then
    echo 'The current workflow did not create the missing badge exactly once.' >&2
    exit 1
fi

if ! grep -q -- '--method PUT .*message=Add coverage badge' "$mock_log"; then
    echo 'The missing badge was not created.' >&2
    exit 1
fi

if grep -q -- 'sha=' "$mock_log"; then
    echo 'The missing badge create unexpectedly supplied a blob SHA.' >&2
    exit 1
fi
