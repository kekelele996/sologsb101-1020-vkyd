/**
 * 中心联合目录对账数据模型与解析逻辑
 * 馆际联合目录中心发回对账清单：一行一条，先收藏号，再联合目录号和中心著录年代。
 * 对上的把联合目录号与中心著录年代补到本馆拓本上；查不到的收藏号列作待认领。
 */

/** 对账清单中的一行（收藏号 → 联合目录号 + 中心著录年代） */
export interface ReconcileRow {
  /** 收藏号（本馆拓本核对依据） */
  collectionNo: string;
  /** 联合目录号 */
  unionNo: string;
  /** 中心著录年代 */
  centerDate: string;
}

/** 已匹配到本馆拓本的对账结果 */
export interface ReconcileMatch extends ReconcileRow {
  /** 匹配到的拓本 id */
  rubbingId: string;
  /** 所属碑刻 id */
  steleId: string;
}

/** 待认领的对账条目（收藏号在本馆拓本中找不到，留待认领，不悄悄丢弃） */
export interface PendingReconciliation extends ReconcileRow {
  /** 收藏号（主键） */
  collectionNo: string;
  createdAt: number;
  updatedAt: number;
}

/** 一次对账的结果汇总 */
export interface ReconcileResult {
  /** 有效行数 */
  total: number;
  /** 匹配成功的条目 */
  matched: ReconcileMatch[];
  /** 待认领的条目 */
  pending: ReconcileRow[];
  /** 格式错误的行（行号 + 原因） */
  malformed: string[];
}

/** 规范化收藏号：去首尾空白 */
export function normalizeCollectionNo(value: string): string {
  return value.trim();
}

/** 判断两个收藏号是否一致（去空白后比较） */
export function sameCollectionNo(a: string, b: string): boolean {
  return normalizeCollectionNo(a) === normalizeCollectionNo(b);
}

/**
 * 解析对账清单文本。
 * 一行一条，字段间以空白（空格 / 制表符）分隔：收藏号 联合目录号 中心著录年代。
 * 中心著录年代允许含空格（取第二个字段之后的全部内容）。
 * 同一清单内重复收藏号以晚到的为准（后面的覆盖前面的）。
 */
export function parseReconcileList(text: string): { rows: ReconcileRow[]; malformed: string[] } {
  const rows: ReconcileRow[] = [];
  const malformed: string[] = [];
  const indexByCollection = new Map<string, number>();

  text.split(/\r?\n/).forEach((rawLine, lineNo) => {
    const line = rawLine.trim();
    if (!line) return;
    const parts = line.split(/\s+/);
    const collectionNo = normalizeCollectionNo(parts[0] ?? '');
    if (!collectionNo) {
      malformed.push(`第 ${lineNo + 1} 行：缺少收藏号`);
      return;
    }
    const unionNo = (parts[1] ?? '').trim();
    const centerDate = parts.slice(2).join(' ').trim();
    if (!unionNo && !centerDate) {
      malformed.push(`第 ${lineNo + 1} 行：${collectionNo} 缺少联合目录号与中心著录年代`);
      return;
    }
    const row: ReconcileRow = { collectionNo, unionNo, centerDate };
    const existingIndex = indexByCollection.get(collectionNo);
    if (existingIndex !== undefined) {
      // 同一清单内重复：以晚到的为准
      rows[existingIndex] = row;
    } else {
      indexByCollection.set(collectionNo, rows.length);
      rows.push(row);
    }
  });

  return { rows, malformed };
}
