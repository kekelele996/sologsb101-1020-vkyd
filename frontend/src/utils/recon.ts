/**
 * 中心对账清单的解析与匹配计划（纯函数，不触碰 IndexedDB）
 * 行格式：收藏号 联合目录号 中心著录年代（Tab / 中英文逗号 / 连续空白分隔）
 * 同一收藏号出现多行时以靠后的行为准（晚到为准）。
 */
import type { ReconEntry } from '@/types/recon';
import type { Rubbing } from '@/types/rubbing';

export interface ReconParseResult {
  entries: ReconEntry[];
  /** 无法解析或缺字段而跳过的行数 */
  skipped: number;
}

/** 解析中心发回的对账清单文本 */
export function parseReconList(text: string): ReconParseResult {
  const byCollectionNo = new Map<string, ReconEntry>();
  let skipped = 0;
  text.split(/\r?\n/).forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith('//')) return;
    // 优先按 Tab / 中英文逗号切；不足三段再按连续空白切
    let parts = line
      .split(/[\t,，]/)
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
    if (parts.length < 3) {
      parts = line.split(/\s+/).filter((part) => part.length > 0);
    }
    if (parts.length < 3) {
      skipped += 1;
      return;
    }
    const [collectionNo, unionCatalogNo] = parts;
    const centerDate = parts.slice(2).join(' ');
    if (!collectionNo || !unionCatalogNo) {
      skipped += 1;
      return;
    }
    // Map 后写覆盖先写：同一收藏号在本批内以靠后的行为准
    byCollectionNo.set(collectionNo, { collectionNo, unionCatalogNo, centerDate });
  });
  return { entries: [...byCollectionNo.values()], skipped };
}

export interface ReconMatch {
  rubbingId: string;
  entry: ReconEntry;
}

export interface ReconPlan {
  /** 对上的：拓本 id + 中心条目 */
  matched: ReconMatch[];
  /** 查不到收藏号的：转入待认领 */
  unmatched: ReconEntry[];
}

/** 按收藏号把清单条目分到「对上 / 待认领」两组 */
export function planReconciliation(entries: ReconEntry[], rubbings: Rubbing[]): ReconPlan {
  const byCollectionNo = new Map<string, Rubbing>();
  rubbings.forEach((rubbing) => {
    const key = rubbing.collectionNo.trim();
    if (key && !byCollectionNo.has(key)) byCollectionNo.set(key, rubbing);
  });
  const matched: ReconMatch[] = [];
  const unmatched: ReconEntry[] = [];
  entries.forEach((entry) => {
    const rubbing = byCollectionNo.get(entry.collectionNo);
    if (rubbing) matched.push({ rubbingId: rubbing.id, entry });
    else unmatched.push(entry);
  });
  return { matched, unmatched };
}
