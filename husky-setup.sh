# This tells your local github repo to run husky without the need to
# install husky directly. I have created a docker image that will
# containerized version of husky.
# TODO: RUN THIS SCRIPT IN EACH SERVICE. I HAVE PROVIDED THIS SCRIPT IN EACH

# THESE COMMANDS DO NOT WORK IN WINDOWS POWERSHELL OR CMD...
# THEY NEED TO BE RUN FROM GIT BASH TERMINAL IF ON WINDOWS.
# IF ON LINUX OR MAC, THEY CAN BE RUN FROM TERMINAL.

# To run this script, run this command on all OS'
# (requires Git to be installed):
# - sh husky-setup.sh
#
git config core.hooksPath .husky

# To verify this worked:
EXPECTED_OUTPUT=".husky"
ACTUAL_OUTPUT=$(git config --get core.hooksPath)

echo "Output should be $EXPECTED_OUTPUT, output: '$ACTUAL_OUTPUT'"

echo "If your output is not .husky, this script failed."

# Output should be ".husky"

# Additionally, the 'commit-msg' file in the .husky folder needs
# to be executable in order to work:
# 'chmod +x .husky/commit-msg'
