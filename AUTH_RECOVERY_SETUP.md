# 邮箱与手机验证码配置

豆格的找回密码流程支持已绑定并验证的邮箱或手机号。验证码有效期为 10 分钟，同一验证码最多尝试 5 次，同一联系方式 60 秒内不能重复发送；密码重置成功后，该账号已有登录会话会全部失效。

## 本地测试模式

开发阶段可让服务器把验证码写入终端，并在页面中显示测试码：

```powershell
$env:PINDOU_VERIFICATION_MODE='console'
node server.js
```

此模式只能用于本机或可信局域网测试，公网部署前必须删除该环境变量。

## 邮箱验证码（SMTP 465）

当前实现使用 SMTP over TLS，适用于提供 465 端口的企业邮箱、QQ 邮箱、163 邮箱等。密码通常需要填写邮箱服务商生成的“客户端授权码”，而不是网页登录密码。

```powershell
$env:SMTP_HOST='smtp.example.com'
$env:SMTP_PORT='465'
$env:SMTP_USER='noreply@example.com'
$env:SMTP_PASS='邮箱客户端授权码'
$env:SMTP_FROM='noreply@example.com'
node server.js
```

正式环境不要设置 `SMTP_ALLOW_INSECURE=1`。服务器配置完成后，访问 `/api/auth/config` 可以查看邮箱验证码渠道是否就绪，但不会返回任何密钥。

## 手机验证码（腾讯云短信）

先在腾讯云完成实名认证和短信服务开通，创建短信应用，并申请通过短信签名与验证码模板。当前代码按两个模板参数发送：验证码 `{1}` 和有效分钟数 `{2}`，例如：

```text
您的验证码是：{1}，{2} 分钟内有效，请勿告知他人。
```

然后配置：

```powershell
$env:TENCENTCLOUD_SECRET_ID='SecretId'
$env:TENCENTCLOUD_SECRET_KEY='SecretKey'
$env:TENCENT_SMS_SDK_APP_ID='短信应用 SdkAppId'
$env:TENCENT_SMS_SIGN_NAME='已审核通过的签名内容'
$env:TENCENT_SMS_TEMPLATE_ID='已审核通过的模板 ID'
$env:TENCENT_SMS_REGION='ap-guangzhou'
node server.js
```

手机号会转换为 E.164 格式，例如 `13800138000` 会发送为 `+8613800138000`。密钥只能通过服务器环境变量提供，不要写入源码或上传到 GitHub。

腾讯云官方资料：

- [国内短信快速入门](https://cloud.tencent.com/document/product/382/37745)
- [SendSms API（2021-01-11）](https://cloud.tencent.com/document/api/382/55981)
- [短信签名审核标准](https://cloud.tencent.com/document/product/382/39022)

