#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
APP_NAME="robrowser-remote-client"
ECOSYSTEM="$PROJECT_ROOT/ecosystem.config.js"

cd "$PROJECT_ROOT"

if ! command -v pm2 >/dev/null 2>&1; then
  echo "未找到 pm2，请先安装: npm install -g pm2"
  exit 1
fi

mkdir -p logs

usage() {
  cat <<EOF
用法: $0 <命令>

命令:
  start    启动服务（默认）
  stop     停止服务
  restart  重启服务
  reload   零停机重载
  delete   从 pm2 进程列表移除
  logs     查看日志
  status   查看运行状态

示例:
  $0 start
  $0 logs
EOF
}

cmd="${1:-start}"

case "$cmd" in
  start)
    pm2 start "$ECOSYSTEM"
    pm2 save 2>/dev/null || true
    ;;
  stop)
    pm2 stop "$APP_NAME"
    ;;
  restart)
    pm2 restart "$APP_NAME"
    ;;
  reload)
    pm2 reload "$APP_NAME"
    ;;
  delete)
    pm2 delete "$APP_NAME"
    ;;
  logs)
    pm2 logs "$APP_NAME"
    ;;
  status)
    pm2 status "$APP_NAME"
    ;;
  -h|--help|help)
    usage
    ;;
  *)
    echo "未知命令: $cmd"
    usage
    exit 1
    ;;
esac
