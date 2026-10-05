/**
 * 馆际联合目录对账（Recon）数据模型
 * 中心发回的对账清单一行一条：收藏号 → 联合目录号 + 中心著录年代；
 * 本馆查不到收藏号的条目留存为「待认领」，列出来等认领，不能丢弃。
 */

/** 对账清单解析后的一行（中心条目） */
export interface ReconEntry {
  /** 收藏号（对应本馆拓本的 collectionNo） */
  collectionNo: string;
  /** 联合目录号 */
  unionCatalogNo: string;
  /** 中心著录年代 */
  centerDate: string;
}

/** 待认领条目：本馆暂无对应收藏号的中心条目，留存等认领 */
export interface ReconClaim {
  id: string;
  /** 中心清单上的收藏号 */
  collectionNo: string;
  /** 联合目录号 */
  unionCatalogNo: string;
  /** 中心著录年代（同一收藏号晚到的为准） */
  centerDate: string;
  /** 最近一次收到该条目的时间戳 */
  receivedAt: number;
  createdAt: number;
  updatedAt: number;
}

export type ReconClaimDraft = Omit<ReconClaim, 'id' | 'createdAt' | 'updatedAt'>;
