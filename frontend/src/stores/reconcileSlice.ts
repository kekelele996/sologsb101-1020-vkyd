/**
 * 中心联合目录对账 slice（Redux Toolkit）
 * 维护待认领条目与对账结果；对账写入走单事务，任一失败整体回滚到贴之前的样子。
 * 编目员填写的拓法、纸墨、尺寸、损泐字位与年代判断一律不覆盖。
 */
import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';
import { db } from '@/utils/db';
import {
  parseReconcileList,
  sameCollectionNo,
  type PendingReconciliation,
  type ReconcileMatch,
  type ReconcileResult,
} from '@/types/reconcile';
import type { Rubbing } from '@/types/rubbing';
import { loadRubbings } from './rubbingSlice';
import type { RootState } from './store';

export interface ReconcileState {
  pending: PendingReconciliation[];
  loading: boolean;
  ready: boolean;
  error: string;
  /** 最近一次对账结果（用于页面回显） */
  lastResult: ReconcileResult | null;
}

const initialState: ReconcileState = {
  pending: [],
  loading: false,
  ready: false,
  error: '',
  lastResult: null,
};

export const loadPending = createAsyncThunk('reconcile/loadPending', async () => {
  const rows = await db.pendingReconciliations.toArray();
  return rows.sort((a, b) => b.updatedAt - a.updatedAt);
});

/**
 * 对账：解析中心发回的清单，按收藏号核对。
 * 对上的把联合目录号与中心著录年代补到本馆拓本；查不到的列作待认领。
 * 全部写入在同一事务内，任一失败整体回滚。
 */
export const reconcileList = createAsyncThunk(
  'reconcile/list',
  async (text: string, { dispatch, getState }) => {
    const { rows, malformed } = parseReconcileList(text);
    const state = getState() as RootState;
    const rubbings = state.rubbing.items;
    const now = Date.now();

    const matched: ReconcileMatch[] = [];
    const pendingRows: ReconcileResult['pending'] = [];

    rows.forEach((row) => {
      const rubbing = rubbings.find((item) => sameCollectionNo(item.collectionNo, row.collectionNo));
      if (rubbing) {
        matched.push({ ...row, rubbingId: rubbing.id, steleId: rubbing.steleId });
      } else {
        pendingRows.push(row);
      }
    });

    // 组装待写入的拓本（仅补 unionNo / centerDate / reconciledAt，其余字段原样保留）
    const rubbingUpdates: Rubbing[] = matched.map((m) => {
      const rubbing = rubbings.find((item) => item.id === m.rubbingId)!;
      return {
        ...rubbing,
        unionNo: m.unionNo,
        centerDate: m.centerDate,
        reconciledAt: now,
        updatedAt: now,
      };
    });

    // 待认领条目：已存在则更新（晚到的为准），否则新增
    const pendingToUpsert: PendingReconciliation[] = pendingRows.map((p) => {
      const existing = state.reconcile.pending.find((item) => sameCollectionNo(item.collectionNo, p.collectionNo));
      return {
        collectionNo: p.collectionNo,
        unionNo: p.unionNo,
        centerDate: p.centerDate,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
    });

    // 本次匹配到的收藏号若此前挂在待认领，认领后删除
    const claimedCollectionNos = matched.map((m) => m.collectionNo);

    // 单事务写入：任一失败整体回滚到贴之前的样子
    await db.transaction('rw', [db.rubbings, db.pendingReconciliations], async () => {
      if (rubbingUpdates.length > 0) await db.rubbings.bulkPut(rubbingUpdates);
      if (pendingToUpsert.length > 0) await db.pendingReconciliations.bulkPut(pendingToUpsert);
      if (claimedCollectionNos.length > 0) await db.pendingReconciliations.bulkDelete(claimedCollectionNos);
    });

    await dispatch(loadRubbings());
    await dispatch(loadPending());

    return { total: rows.length, matched, pending: pendingRows, malformed };
  },
);

/**
 * 认领：把一条待认领条目补到指定拓本上。
 * 写入在同一事务内，失败回滚。
 */
export const claimPending = createAsyncThunk(
  'reconcile/claim',
  async (payload: { collectionNo: string; rubbingId: string }, { dispatch, getState }) => {
    const state = getState() as RootState;
    const pending = state.reconcile.pending.find((item) => sameCollectionNo(item.collectionNo, payload.collectionNo));
    if (!pending) return;
    const rubbing = state.rubbing.items.find((item) => item.id === payload.rubbingId);
    if (!rubbing) return;
    const now = Date.now();
    await db.transaction('rw', [db.rubbings, db.pendingReconciliations], async () => {
      await db.rubbings.put({
        ...rubbing,
        unionNo: pending.unionNo,
        centerDate: pending.centerDate,
        reconciledAt: now,
        updatedAt: now,
      });
      await db.pendingReconciliations.delete(pending.collectionNo);
    });
    await dispatch(loadRubbings());
    await dispatch(loadPending());
  },
);

/**
 * 重新核对：逐条尝试把待认领条目按收藏号匹配到本馆拓本。
 * 匹配到的自动认领，其余继续挂起。写入在同一事务内。
 */
export const recheckPending = createAsyncThunk('reconcile/recheck', async (_void, { dispatch, getState }) => {
  const state = getState() as RootState;
  const rubbings = state.rubbing.items;
  const now = Date.now();
  const claimed: ReconcileMatch[] = [];

  state.reconcile.pending.forEach((p) => {
    const rubbing = rubbings.find((item) => sameCollectionNo(item.collectionNo, p.collectionNo));
    if (rubbing) {
      claimed.push({ ...p, rubbingId: rubbing.id, steleId: rubbing.steleId });
    }
  });

  if (claimed.length > 0) {
    await db.transaction('rw', [db.rubbings, db.pendingReconciliations], async () => {
      const rubbingUpdates: Rubbing[] = claimed.map((m) => {
        const rubbing = rubbings.find((item) => item.id === m.rubbingId)!;
        return {
          ...rubbing,
          unionNo: m.unionNo,
          centerDate: m.centerDate,
          reconciledAt: now,
          updatedAt: now,
        };
      });
      await db.rubbings.bulkPut(rubbingUpdates);
      await db.pendingReconciliations.bulkDelete(claimed.map((m) => m.collectionNo));
    });
    await dispatch(loadRubbings());
  }
  await dispatch(loadPending());

  return { claimed: claimed.length, stillPending: state.reconcile.pending.length - claimed.length };
});

const reconcileSlice = createSlice({
  name: 'reconcile',
  initialState,
  reducers: {
    clearLastResult(state) {
      state.lastResult = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(loadPending.pending, (state) => {
        state.loading = true;
      })
      .addCase(loadPending.fulfilled, (state, action) => {
        state.pending = action.payload;
        state.loading = false;
        state.ready = true;
        state.error = '';
      })
      .addCase(loadPending.rejected, (state, action) => {
        state.loading = false;
        state.ready = true;
        state.error = action.error.message ?? '待认领条目读取失败';
      })
      .addCase(reconcileList.pending, (state) => {
        state.loading = true;
        state.error = '';
      })
      .addCase(reconcileList.fulfilled, (state, action) => {
        state.loading = false;
        state.ready = true;
        state.lastResult = action.payload;
      })
      .addCase(reconcileList.rejected, (state, action) => {
        state.loading = false;
        state.ready = true;
        state.error = action.error.message ?? '对账写入失败，已回滚到贴之前的样子';
      })
      .addCase(claimPending.fulfilled, (state) => {
        state.error = '';
      })
      .addCase(claimPending.rejected, (state, action) => {
        state.error = action.error.message ?? '认领失败，已回滚';
      })
      .addCase(recheckPending.fulfilled, (state) => {
        state.error = '';
      })
      .addCase(recheckPending.rejected, (state, action) => {
        state.error = action.error.message ?? '重新核对失败，已回滚';
      });
  },
});

export const { clearLastResult } = reconcileSlice.actions;

export const selectReconcileState = (state: RootState): ReconcileState => state.reconcile;
export const selectPendingReconciliations = (state: RootState): PendingReconciliation[] => state.reconcile.pending;
export const selectLastReconcileResult = (state: RootState): ReconcileResult | null => state.reconcile.lastResult;

export default reconcileSlice.reducer;
