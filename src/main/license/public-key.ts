/**
 * 授权公钥。私钥只保存在服务端 /etc/pixmint-license/ed25519.key，不进仓库。
 *
 * kid 用于密钥轮换：客户端同时内置旧公钥，服务端换新 kid 后旧 token 仍可验签。
 * PIXMINT_LICENSE_PUBLIC_KEY 只用于本地 E2E / 开发 mock，不能在生产包中设置。
 */
export const PRODUCTION_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAAE8IaikcD4K2kZ9iarvRp95wY5DuanpCFXWrVFabjjI=
-----END PUBLIC KEY-----`

export const PRODUCTION_KEY_ID = 'prod-1'
