# 微信支付 Native 接入准备

豆格的桌面网页支付将使用微信支付 Native API v3。服务器向微信支付创建一笔订单后取得动态 `code_url`，前端把它转换为二维码；用户扫码付款后，服务器必须验证微信支付回调或主动查单，确认金额和订单状态后才能发放一次性 PDF 下载凭证。

当前定价为：游客下载 1.00 元（100 分），已登录账户下载 0.50 元（50 分），超级测试账户免费。金额必须由服务器根据登录状态确定，不能相信浏览器提交的金额。

用户提供的普通微信收款二维码不能关联豆格订单，也无法让服务器可靠判断付款人、金额和支付状态，因此不会用于自动放行下载。

## 需要准备

1. 微信支付普通商户号，并开通 Native 支付权限。
2. 已认证的公众号、小程序或移动应用 APPID，并与商户号绑定。
3. 商户 API 证书序列号与商户私钥 PEM 文件。
4. 微信支付公钥 ID 与公钥 PEM 文件。
5. 32 字节 API v3 密钥。
6. 公网 HTTPS 域名，以及可被微信访问的支付通知地址。

## 接入顺序

1. 在微信支付商户平台申请普通商户号并开通 Native 支付。
2. 准备一个已认证的公众号、小程序或移动应用 APPID，并在商户平台绑定该 APPID。
3. 下载商户 API 证书私钥并记录证书序列号；同时获取微信支付公钥和公钥 ID。
4. 在商户平台设置 32 字节 API v3 密钥。
5. 将网站部署到公网 HTTPS 域名。树莓派可使用 Caddy 自动申请 HTTPS，但路由器必须提供公网入口；只有局域网地址时不能接收微信回调。
6. 设置下方环境变量，重启服务器，通过 `/api/billing/config` 检查 `wechatPay.configured` 是否为 `true`。
7. 后端调用 `POST https://api.mch.weixin.qq.com/v3/pay/transactions/native`，游客订单金额写 100，登录用户订单金额写 50；返回的 `code_url` 转成二维码。
8. 支付通知必须先验证 `Wechatpay-*` 请求签名，再用 API v3 密钥解密通知资源；随后核对商户号、订单号、币种和金额，使用数据库事务把订单从 `pending` 改为 `paid`。重复回调必须保持幂等。
9. 只有数据库已经确认付款的订单才能获得一次性下载凭证；不能仅凭前端“支付成功”页面放行。

本地 `localhost` 或只在家庭局域网开放的树莓派地址不能直接接收微信支付回调。公网部署时建议由 Caddy/Nginx 提供 HTTPS，再把通知转发给豆格服务。

## 服务器环境变量

```powershell
$env:WECHATPAY_MCHID='你的商户号'
$env:WECHATPAY_APPID='已绑定商户号的APPID'
$env:WECHATPAY_CERT_SERIAL_NO='商户API证书序列号'
$env:WECHATPAY_PRIVATE_KEY_PATH='D:\secure\apiclient_key.pem'
$env:WECHATPAY_PUBLIC_KEY_ID='微信支付公钥ID'
$env:WECHATPAY_PUBLIC_KEY_PATH='D:\secure\wechatpay_public_key.pem'
$env:WECHATPAY_API_V3_KEY='32字节APIv3密钥'
$env:WECHATPAY_NOTIFY_URL='https://你的域名/api/payments/wechat/notify'
node server.js
```

不要把私钥、API v3 密钥、证书或真实环境变量值提交到 GitHub。豆格只会从运行环境读取这些值。

## 官方文档

- [Native 支付产品介绍](https://pay.wechatpay.cn/doc/v3/merchant/4012791874)
- [Native 支付开发接入准备](https://pay.wechatpay.cn/doc/v3/merchant/4015614538)
- [Native 下单 API](https://pay.wechatpay.cn/doc/v3/merchant/4012791877)
- [Native 支付开发流程](https://pay.wechatpay.cn/doc/v3/merchant/4012791891)
- [支付成功回调通知](https://pay.wechatpay.cn/doc/v3/merchant/4012791861)
