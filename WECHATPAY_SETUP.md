# 微信支付 Native 接入准备

豆格的桌面网页支付将使用微信支付 Native API v3。服务器向微信支付创建一笔订单后取得动态 `code_url`，前端把它转换为二维码；用户扫码付款后，服务器必须验证微信支付回调或主动查单，确认金额和订单状态后才能发放一次性 PDF 下载凭证。

用户提供的普通微信收款二维码不能关联豆格订单，也无法让服务器可靠判断付款人、金额和支付状态，因此不会用于自动放行下载。

## 需要准备

1. 微信支付普通商户号，并开通 Native 支付权限。
2. 已认证的公众号、小程序或移动应用 APPID，并与商户号绑定。
3. 商户 API 证书序列号与商户私钥 PEM 文件。
4. 微信支付公钥 ID 与公钥 PEM 文件。
5. 32 字节 API v3 密钥。
6. 公网 HTTPS 域名，以及可被微信访问的支付通知地址。

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
