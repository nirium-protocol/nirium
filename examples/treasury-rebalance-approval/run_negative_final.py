#!/usr/bin/env python3
"""Run negative test directly using the src modules."""
import sys
import os
import asyncio

SCRIPT_DIR = r'C:\Users\User\.local\share\opencode\worktree\d25dc5\witty-mountain\_hf41\nirium_443\examples\treasury-rebalance-approval'
sys.path.insert(0, SCRIPT_DIR)
os.chdir(SCRIPT_DIR)

from dotenv import load_dotenv
load_dotenv('.env.testnet')

import sys
sys.argv = ['main.py', '--negative-testnet']

import main
asyncio.run(main.main())