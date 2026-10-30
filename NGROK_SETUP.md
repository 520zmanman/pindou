# 豆格 ngrok 公网访问

豆格使用独立的 ngrok 客户端和配置，不会覆盖 OpenClaw 的 ngrok 账户。

## 首次配置

1. 注册一个新的 ngrok 免费账户并完成邮箱验证。
2. 在 ngrok 控制台打开 `Your Authtoken` 页面并复制 Authtoken。
3. 双击项目根目录的 `configure-ngrok.bat`。
4. 在窗口中粘贴 Authtoken 并回车。输入时不会显示字符。

令牌保存在 `data/ngrok-pindou.yml`，该目录已被 Git 忽略。不要把令牌发送到聊天、截图或提交到 GitHub。

## 每次启动公网网站

双击 `start-public-ngrok.bat`。脚本会：

1. 校验豆格专用 ngrok 配置；
2. 启动 `http://127.0.0.1:4173`；
3. 使用新账户自动分配的固定免费开发域名建立 HTTPS 公网入口。

ngrok 窗口会显示类似以下内容：

```text
Forwarding  https://example.ngrok-free.dev -> http://localhost:4173
```

免费账户的开发域名绑定到该 ngrok 账户，重新启动后仍会使用同一个域名。窗口关闭、电脑关机或网络断开时，公网网站会离线，但域名本身不会改变。

## 注意事项

- 当前赞赏码模式无法自动验证是否付款，只适合测试或小范围使用。
- 免费 ngrok 有流量和请求次数限制，并可能显示 ngrok 提示页。
- 公开网站意味着账号注册、图片处理和下载接口可以被互联网访问，请定期备份 `data/pindou.db`。
- 不要同时把同一个免费开发域名绑定到 OpenClaw 和豆格；本方案使用单独的新账户避免冲突。

