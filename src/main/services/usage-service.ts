import {
  dayKey,
  type UsageEvaluation,
  type UsageFeature,
  type UsageView
} from '../../shared/usage'
import type { UsageStore } from '../usage-store'
import type { LicenseService } from '../license/service'

export interface UsageServiceOptions {
  store: UsageStore
  license: LicenseService
  now?: () => number
  /** 开发版不限次数；打包发布版和强制测试模式下为 false。 */
  devUnlimited?: boolean
  /** 超限时由入口层决定：隐藏覆盖层并打开购买窗 */
  onExceeded?: (feature: UsageFeature) => void
}

/**
 * 配额服务是四个功能门禁的唯一入口。
 * Pro 直接放行且不计数；免费用户达到上限时只触发一次购买窗回调。
 */
export class UsageService {
  private readonly now: () => number

  constructor(private readonly options: UsageServiceOptions) {
    this.now = options.now ?? Date.now
  }

  private isUnlimited(): boolean {
    return this.options.devUnlimited === true || this.options.license.isPro()
  }

  view(): UsageView {
    return {
      pro: this.options.license.isPro(),
      unlimited: this.options.devUnlimited === true,
      ...this.options.store.snapshot()
    }
  }

  check(feature: UsageFeature): UsageEvaluation {
    if (this.isUnlimited()) {
      return {
        feature,
        day: dayKey(this.now()),
        limit: -1,
        used: 0,
        remaining: -1,
        allowed: true
      }
    }
    return this.options.store.evaluate(feature)
  }

  consume(feature: UsageFeature): UsageEvaluation {
    if (this.isUnlimited()) return this.check(feature)
    const evaluation = this.options.store.consume(feature)
    if (!evaluation.allowed) this.options.onExceeded?.(feature)
    return evaluation
  }

  refund(feature: UsageFeature): void {
    if (this.isUnlimited()) return
    this.options.store.refund(feature)
  }
}
