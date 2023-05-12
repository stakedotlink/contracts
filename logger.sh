#!/bin/bash

if [ $# -ne 2 ]; then
    echo "Incorrect number of arguments supplied. Please provide the text and the log file path."
    exit 1
fi

TEXT="$1"
LOGFILE="$2"

echo "$TEXT" >>$LOGFILE

exit 0
