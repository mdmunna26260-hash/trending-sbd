#!/bin/bash
# SINZO VPS — one-time swap setup (prevents crashes on traffic spikes)
# Run once as root on the VPS: bash setup-swap.sh
set -e
if swapon --show | grep -q swap; then
  echo "Swap already active:"
  swapon --show
  exit 0
fi
echo "Creating 2GB swap file..."
fallocate -l 2G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
# persist across reboots
grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
# use swap more readily under memory pressure (good for low-RAM VPS)
sysctl vm.swappiness=20 >/dev/null
grep -q 'vm.swappiness' /etc/sysctl.conf || echo 'vm.swappiness=20' >> /etc/sysctl.conf
# reduce OOM risk for the database
sysctl vm.overcommit_memory=1 >/dev/null
grep -q 'vm.overcommit_memory' /etc/sysctl.conf || echo 'vm.overcommit_memory=1' >> /etc/sysctl.conf
echo ""
echo "Swap active (2GB):"
free -h
