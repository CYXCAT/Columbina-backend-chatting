#!/bin/sh
set -eu

if [ "$#" -ne 3 ]; then
  echo "usage: $0 <extracted-unitypackage-dir> <unity-project-dir> <sdk-root-name>" >&2
  exit 2
fi

package_dir=$1
project_dir=$2
sdk_root=$3

find "$package_dir" -name pathname -print0 | while IFS= read -r -d '' pathname_file; do
  item_dir=${pathname_file%/pathname}
  item_path=$(cat "$pathname_file")

  case "$item_path" in
    "Assets/$sdk_root"|"Assets/$sdk_root/"*) ;;
    *) continue ;;
  esac

  case "$item_path" in
    */API-Example|*/API-Example/*|*/Plugins/Android|*/Plugins/Android/*|*/Plugins/x86|*/Plugins/x86/*|*/Plugins/x86_64|*/Plugins/x86_64/*|*/Plugins/iOS/ios.meta|*/Agora-Unity-RTM-SDK/Plugins/macOS/AgoraRtcWrapperUnity.bundle|*/Agora-Unity-RTM-SDK/Plugins/macOS/AgoraRtcWrapperUnity.bundle/*)
      continue
      ;;
  esac

  destination="$project_dir/$item_path"
  if [ -f "$item_dir/asset" ] || [ -L "$item_dir/asset" ]; then
    mkdir -p "${destination%/*}"
    cp -a "$item_dir/asset" "$destination"
  else
    mkdir -p "$destination"
  fi
  if [ -f "$item_dir/asset.meta" ]; then
    cp "$item_dir/asset.meta" "$destination.meta"
  fi
done
