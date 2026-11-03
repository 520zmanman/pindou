# 树莓派部署与使用

## 当前部署

- 网站：`http://192.168.18.242:4173/`（同一局域网）
- SSH：`ssh pi@192.168.18.242`
- 项目：`/home/pi/pindou`
- Samba：`\\192.168.18.242\pi\pindou`
- 服务：`pindou.service`，已配置开机自启、异常退出自动重启。
- 私有数据：`/home/pi/pindou/data`，不要提交到 Git 或公开分享。
- 启动前数据库备份：`/home/pi/pindou/backups/pre-start-20261103.db`。

打开网站后使用原账号登录。更换网站地址后，原浏览器 IndexedDB 本地草稿不会自动迁移；已迁移的账号云草稿可以登录后恢复，画廊作品仍在。

电脑可以关机，树莓派需保持开机和网络连接。建议在路由器中为树莓派保留当前 IP。当前没有配置公网访问或 HTTPS，请只在可信局域网使用。

## 日常维护（在 SSH 终端执行）

```bash
# 状态，按 q 退出
sudo systemctl status pindou --no-pager
# 重启 / 停止 / 启动
sudo systemctl restart pindou
sudo systemctl stop pindou
sudo systemctl start pindou
# 最近的运行日志
journalctl -u pindou -n 100 --no-pager
# 跟踪日志，Ctrl+C 退出
journalctl -u pindou -f
```

改密码：登录 SSH 后执行 `passwd`，按提示输入旧密码和新密码。部署专用密钥目前尚未通过 SSH 认证，日常可先使用密码登录。

## 手动备份

为避免复制正在写入的 SQLite 数据库造成损坏，先停服务，再打包整个 data 目录，然后重新启动。下面三步请按顺序执行；即使打包失败，也应执行最后的启动命令。

```bash
sudo systemctl stop pindou
tar -czf "/home/pi/pindou/backups/data-$(date +%Y%m%d-%H%M%S).tar.gz" -C /home/pi/pindou data
sudo systemctl start pindou
```

将备份复制到另一台设备保存；备份包含账号、余额、积分、邮箱配置等敏感信息，不能公开。不要把旧数据库直接覆盖到运行中的服务上。

## 更新代码

当前部署为文件复制，不是 Git 克隆。先备份，再通过 Samba 更新应用源码；不要覆盖 `data`、`backups`，不要复制 Windows 的 `node_modules`。如果依赖有变化，在树莓派执行：

```bash
cd /home/pi/pindou
npm ci --omit=dev --no-audit --no-fund
sudo systemctl restart pindou
```

## 上线限制

赞赏码截图 OCR 不能向支付平台确认真实到账，也不能可靠防止伪造截图，目前属于试用流程，不宜作为公开商业收费的依据。正式公网运营前需要支付回调验签、HTTPS、内容审核、备份及安全检查。

邮箱配置已迁移，但本次部署没有发送真实邮件或执行真实扣款测试。
