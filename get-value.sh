#!/bin/bash

# Used to get the value from a JSON file for a given key.
# This is needed for retrieval of config vars in contracts.
if [ "$#" -ne 2 ]; then
    echo "Usage: $0 json_file key"
    exit 1
fi

JSON_FILE="$1"
KEY="$2"

if [ ! -f "$JSON_FILE" ]; then
    echo "Error: JSON file not found."
    exit 1
fi

VALUE=$(jq -r ".${KEY}" "$JSON_FILE")

if [ "$VALUE" == "null" ]; then
    echo "Error: Key not found in JSON file."
    exit 1
fi

echo $VALUE
