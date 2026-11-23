import sys
import os
import asyncio

# Setup paths
SCRIPT_DIR = r'C:\Users\User\.local\share\opencode\worktree\d25dc5\witty-mountain\_hf41\nirium_443\examples\treasury-rebalance-approval'
sys.path.insert(0, SCRIPT_DIR)
os.chdir(SCRIPT_DIR)

# Set up environment
from dotenv import load_dotenv
load_dotenv('.env.testnet')

# Set sys.argv
sys.argv = ['main.py', '--negative-testnet']

# Import and run
import main
import asyncio
asyncio.run(main.main())