/**
 * /reconcile 中心联合目录对账台
 * 收下中心发回的对账清单（一行一条：收藏号 + 联合目录号 + 中心著录年代），
 * 按收藏号核对：对上的补到本馆拓本（不触碰拓法、纸墨、尺寸、损泐字位与编目员年代判断），
 * 查不到的列作待认领，不悄悄丢弃。写库失败整体回滚。
 * 消费 Rubbing、PendingReconciliation；复用 <StatBadge>、<EmptyPanel>。
 */
import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  App as AntdApp,
  Button,
  Card,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  CheckCircleOutlined,
  CloudUploadOutlined,
  ExclamationCircleOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import EmptyPanel from '@/components/common/EmptyPanel';
import StatBadge from '@/components/common/StatBadge';
import { useAppDispatch, useAppSelector } from '@/stores/store';
import { selectSteles } from '@/stores/steleSlice';
import { selectRubbings } from '@/stores/rubbingSlice';
import {
  claimPending,
  loadPending,
  reconcileList,
  recheckPending,
  selectLastReconcileResult,
  selectPendingReconciliations,
} from '@/stores/reconcileSlice';
import { sameCollectionNo, type PendingReconciliation } from '@/types/reconcile';

const { TextArea } = Input;

const SAMPLE = `TB-0101	LH-001	明嘉靖
TB-0102	LH-002	清乾隆
TB-0999	LH-099	待考`;

export default function ReconcileView() {
  const { message } = AntdApp.useApp();
  const dispatch = useAppDispatch();

  const steles = useAppSelector(selectSteles);
  const rubbings = useAppSelector(selectRubbings);
  const pending = useAppSelector(selectPendingReconciliations);
  const lastResult = useAppSelector(selectLastReconcileResult);

  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [claimTarget, setClaimTarget] = useState<PendingReconciliation | null>(null);
  const [claimRubbingId, setClaimRubbingId] = useState<string>('');

  // 已对账拓本数
  const reconciledCount = useMemo(
    () => rubbings.filter((r) => r.reconciledAt !== null && r.reconciledAt > 0).length,
    [rubbings],
  );

  const steleTitle = (steleId: string): string => steles.find((s) => s.id === steleId)?.title ?? steleId;

  // 拓本选择项（按碑刻分组）
  const rubbingOptions = useMemo(
    () =>
      steles.map((stele) => ({
        label: stele.title,
        options: rubbings
          .filter((r) => r.steleId === stele.id)
          .map((r) => ({
            value: r.id,
            label: `第 ${r.versionNo} 版 · ${r.collectionNo || '未编收藏号'}`,
          })),
      })),
    [rubbings, steles],
  );

  // 进入页面时刷新待认领条目，保证与其他页面的改动同步
  useEffect(() => {
    dispatch(loadPending());
  }, [dispatch]);

  const handleReconcile = async (): Promise<void> => {
    if (!text.trim()) {
      message.warning('请先粘贴中心发回的对账清单');
      return;
    }
    setSubmitting(true);
    try {
      const result = await dispatch(reconcileList(text)).unwrap();
      if (result.malformed.length > 0) {
        message.warning(`对账完成：匹配 ${result.matched.length} 条，待认领 ${result.pending.length} 条，${result.malformed.length} 行格式有误`);
      } else {
        message.success(`对账完成：匹配 ${result.matched.length} 条，待认领 ${result.pending.length} 条`);
      }
      setText('');
    } catch (error) {
      message.error(`对账失败，已回滚：${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setSubmitting(false);
    }
  };

  const openClaim = (record: PendingReconciliation): void => {
    setClaimTarget(record);
    // 若有同收藏号的拓本，默认选中
    const hit = rubbings.find((r) => sameCollectionNo(r.collectionNo, record.collectionNo));
    setClaimRubbingId(hit?.id ?? '');
  };

  const submitClaim = async (): Promise<void> => {
    if (!claimTarget) return;
    if (!claimRubbingId) {
      message.warning('请选择要补录到的拓本');
      return;
    }
    await dispatch(claimPending({ collectionNo: claimTarget.collectionNo, rubbingId: claimRubbingId })).unwrap();
    message.success(`已认领：${claimTarget.collectionNo}`);
    setClaimTarget(null);
    setClaimRubbingId('');
  };

  const handleRecheck = async (): Promise<void> => {
    const result = await dispatch(recheckPending()).unwrap();
    if (result.claimed > 0) {
      message.success(`重新核对：已认领 ${result.claimed} 条，仍待认领 ${result.stillPending} 条`);
    } else {
      message.info(`重新核对：${result.stillPending} 条仍未找到对应拓本`);
    }
  };

  const pendingColumns: ColumnsType<PendingReconciliation> = [
    { title: '收藏号', dataIndex: 'collectionNo', width: 140, render: (v: string) => <Tag color="gold">{v}</Tag> },
    { title: '联合目录号', dataIndex: 'unionNo', width: 140, render: (v: string) => v || '—' },
    { title: '中心著录年代', dataIndex: 'centerDate', width: 140, render: (v: string) => v || '—' },
    {
      title: '收到时间',
      dataIndex: 'createdAt',
      width: 170,
      render: (v: number) => new Date(v).toLocaleString('zh-CN'),
    },
    {
      title: '操作',
      key: 'action',
      width: 120,
      render: (_v, record) => (
        <Button size="small" type="link" onClick={() => openClaim(record)}>
          认领
        </Button>
      ),
    },
  ];

  const matchedColumns: ColumnsType<NonNullType<ReconcileResultSafe>> = [
    { title: '收藏号', dataIndex: 'collectionNo', width: 130, render: (v: string) => <Tag color="green">{v}</Tag> },
    { title: '联合目录号', dataIndex: 'unionNo', width: 130 },
    { title: '中心著录年代', dataIndex: 'centerDate', width: 130 },
    {
      title: '本馆拓本',
      key: 'rubbing',
      render: (_v, record) => {
        const rubbing = rubbings.find((r) => r.id === record.rubbingId);
        if (!rubbing) return '—';
        return `${steleTitle(rubbing.steleId)} · 第 ${rubbing.versionNo} 版`;
      },
    },
  ];

  type NonNullType<T> = T extends (infer U)[] ? U : never;
  type ReconcileResultSafe = NonNullable<typeof lastResult>['matched'];

  return (
    <div>
      <div className="gb-page-head">
        <div>
          <h2>中心联合目录对账台</h2>
          <p>
            收下中心发回的对账清单（一行一条：收藏号 + 联合目录号 + 中心著录年代），按收藏号核对补录。
            对上的只补联合目录号与中心著录年代，拓法、纸墨、尺寸、损泐字位与编目员年代判断不动。
          </p>
        </div>
      </div>

      <div className="gb-stat-row">
        <StatBadge label="本馆拓本" value={rubbings.length} suffix="份" tone="primary" />
        <StatBadge label="已对账" value={reconciledCount} suffix="份" tone="success" />
        <StatBadge label="待认领" value={pending.length} suffix="条" tone="warning" />
        {lastResult ? (
          <StatBadge
            label="本次对账"
            value={`${lastResult.matched.length} / ${lastResult.pending.length}`}
            suffix="匹配 / 待认领"
            tone="info"
          />
        ) : null}
      </div>

      <Card
        title="粘贴对账清单"
        extra={
          <Space wrap>
            <Button icon={<ReloadOutlined />} onClick={() => setText(SAMPLE)}>
              填入示例
            </Button>
            <Button
              type="primary"
              icon={<CloudUploadOutlined />}
              loading={submitting}
              onClick={() => void handleReconcile()}
            >
              开始对账
            </Button>
          </Space>
        }
        style={{ marginBottom: 16 }}
      >
        <TextArea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={'每行一条，字段间用空格或制表符分隔：\nTB-0101\tLH-001\t明嘉靖\nTB-0102\tLH-002\t清乾隆'}
          autoSize={{ minRows: 5, maxRows: 12 }}
          style={{ fontFamily: 'monospace', fontSize: 13 }}
        />
        <Alert
          style={{ marginTop: 10 }}
          type="info"
          showIcon
          message="对账说明"
          description="按收藏号核对：对上的把联合目录号与中心著录年代补到本馆拓本；同一收藏号的中心著录年代以晚到的为准，编目员的年代判断不变。查不到的收藏号列作待认领，可在下方手动认领或重新核对。写库失败整体回滚。"
        />
      </Card>

      {lastResult && lastResult.malformed.length > 0 ? (
        <Alert
          style={{ marginBottom: 16 }}
          type="warning"
          showIcon
          icon={<ExclamationCircleOutlined />}
          message={`${lastResult.malformed.length} 行格式有误，已跳过`}
          description={
            <ul style={{ margin: 0, paddingInlineStart: 18 }}>
              {lastResult.malformed.map((m, i) => (
                <li key={i}>{m}</li>
              ))}
            </ul>
          }
        />
      ) : null}

      {lastResult && lastResult.matched.length > 0 ? (
        <Card
          title={
            <Space size={6}>
              <CheckCircleOutlined style={{ color: '#2f6f4f' }} />
              <span>本次匹配成功（{lastResult.matched.length} 条）</span>
            </Space>
          }
          style={{ marginBottom: 16 }}
          styles={{ body: { padding: 0 } }}
        >
          <Table
            rowKey="collectionNo"
            size="small"
            pagination={false}
            columns={matchedColumns}
            dataSource={lastResult.matched}
          />
        </Card>
      ) : null}

      <Card
        title={
          <Space size={6}>
            <ExclamationCircleOutlined style={{ color: '#c9963c' }} />
            <span>待认领（{pending.length} 条）</span>
          </Space>
        }
        extra={
          <Button size="small" icon={<ReloadOutlined />} onClick={() => void handleRecheck()}>
            重新核对
          </Button>
        }
        styles={{ body: { padding: 0 } }}
      >
        {pending.length === 0 ? (
          <EmptyPanel
            title="没有待认领条目"
            description="中心发回的对账清单都已对上，或尚未粘贴过清单。"
            size="small"
          />
        ) : (
          <Table<PendingReconciliation>
            rowKey="collectionNo"
            size="small"
            pagination={{ pageSize: 8 }}
            columns={pendingColumns}
            dataSource={pending}
          />
        )}
      </Card>

      <Modal
        open={claimTarget !== null}
        title={`认领：${claimTarget?.collectionNo ?? ''}`}
        onCancel={() => setClaimTarget(null)}
        onOk={() => void submitClaim()}
        okText="确认认领"
        cancelText="取消"
        destroyOnClose
      >
        {claimTarget ? (
          <Space direction="vertical" size={8} style={{ width: '100%' }}>
            <Typography.Text type="secondary">
              联合目录号 {claimTarget.unionNo || '—'} · 中心著录年代 {claimTarget.centerDate || '—'}
            </Typography.Text>
            <Select
              style={{ width: '100%' }}
              placeholder="选择要补录到的本馆拓本"
              value={claimRubbingId || undefined}
              onChange={(v) => setClaimRubbingId(v)}
              options={rubbingOptions}
            />
          </Space>
        ) : null}
      </Modal>
    </div>
  );
}
