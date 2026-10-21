#!/usr/bin/env bash
set -euo pipefail
# Installation is authorized by the commissioner. This does not install/activate Unity.
# The apt dependency solver determines actual distribution package versions.
sudo -n env NEEDRESTART_MODE=l DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
  adb openjdk-17-jdk-headless qemu-user qemu-system-arm xvfb mesa-utils blender blender-data espeak-ng cmake squashfs-tools-ng squashfuse
