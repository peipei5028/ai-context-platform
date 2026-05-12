import { useEffect, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { getApp, updateApp, deleteApp } from '../api/apps'
import { triggerIndex } from '../api/index'
import { listAppDocs, deleteDocument, downloadFile, uploadDocument } from '../api/documents'
import type { App } from '../api/systems'
import type { Document } from '../api/documents'
import StatusBadge from '../components/StatusBadge'
import ConfirmDialog from '../components/ConfirmDialog'

type TabKey = 'wiki' | 'docs'

const TECH_STACK_OPTIONS = [
  'Java/Spring Boot',
  'Python/Django',
  'Python/FastAPI',
  'Node.js/Koa',
  'Node.js/Express',
  'Go',
  '其他',
]

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '-'
  const d = new Date(iso)
  return d.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// ---------- Main Page ----------
export default function AppDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user } = useAuth()

  const [app, setApp] = useState<App | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<TabKey>('wiki')

  // Documents
  const [docs, setDocs] = useState<Document[]>([])

  // Dialogs
  const [showEdit, setShowEdit] = useState(false)
  const [showDelete, setShowDelete] = useState(false)
  const [showUploadDoc, setShowUploadDoc] = useState(false)
  const [showIndexDialog, setShowIndexDialog] = useState(false)
  const [indexForce, setIndexForce] = useState(false)
  const [deletingDoc, setDeletingDoc] = useState<Document | null>(null)

  // Edit form
  const [editGitUrl, setEditGitUrl] = useState('')
  const [editTechStack, setEditTechStack] = useState('')
  const [editTechStackCustom, setEditTechStackCustom] = useState('')
  const [editOwner, setEditOwner] = useState('')
  const [editBranch, setEditBranch] = useState('')

  // Upload doc form
  const [docFile, setDocFile] = useState<File | null>(null)
  const [docTitle, setDocTitle] = useState('')

  const [submitting, setSubmitting] = useState(false)

  const isAdminOrCreator =
    !!user && !!app && (user.role === 'admin' || user.id === app.created_by)

  // ---------- Data loading ----------
  const loadApp = useCallback(async () => {
    if (!id) return
    setLoading(true)
    try {
      const data = await getApp(id)
      setApp(data)
    } finally {
      setLoading(false)
    }
  }, [id])

  const loadDocs = useCallback(async () => {
    if (!id) return
    try {
      const list = await listAppDocs(id)
      setDocs(list)
    } catch {
      /* ignore */
    }
  }, [id])

  useEffect(() => {
    loadApp()
  }, [loadApp])

  useEffect(() => {
    if (activeTab === 'docs') loadDocs()
  }, [activeTab, loadDocs])

  // ---------- Handlers ----------
  const handleTriggerIndex = () => {
    if (submitting) return
    setIndexForce(false)
    setShowIndexDialog(true)
  }

  const handleConfirmIndex = async () => {
    if (!id || submitting) return
    setShowIndexDialog(false)
    setSubmitting(true)
    try {
      const result = await triggerIndex(id, true, indexForce)
      navigate(`/apps/${id}/index/${result.job_id}`)
    } finally {
      setSubmitting(false)
    }
  }

  const handleEdit = async () => {
    if (!id || submitting) return
    setSubmitting(true)
    try {
      const tech =
        editTechStack === '其他' ? editTechStackCustom : editTechStack
      const updated = await updateApp(id, {
        git_url: editGitUrl,
        tech_stack: tech || undefined,
        owner: editOwner || undefined,
        tracked_branch: editBranch || undefined,
      })
      setApp(updated)
      setShowEdit(false)
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async () => {
    if (!id || submitting) return
    setSubmitting(true)
    try {
      await deleteApp(id)
      navigate(`/systems/${app?.system_id}`)
    } finally {
      setSubmitting(false)
    }
  }

  const handleUploadDoc = async () => {
    if (!id || !docFile || submitting) return
    setSubmitting(true)
    try {
      await uploadDocument(
        `/apps/${id}/documents`,
        docFile,
        'general',
        docTitle || docFile.name,
      )
      setShowUploadDoc(false)
      setDocFile(null)
      setDocTitle('')
      loadDocs()
    } finally {
      setSubmitting(false)
    }
  }

  const handleDeleteDoc = async (doc: Document) => {
    if (submitting) return
    setSubmitting(true)
    try {
      await deleteDocument(doc.id)
      setDocs((prev) => prev.filter((d) => d.id !== doc.id))
      setDeletingDoc(null)
    } finally {
      setSubmitting(false)
    }
  }

  const openEditDialog = () => {
    if (!app) return
    setEditGitUrl(app.git_url)
    setEditTechStack(app.tech_stack ?? '')
    setEditTechStackCustom('')
    setEditOwner(app.owner ?? '')
    setEditBranch(app.tracked_branch)
    setShowEdit(true)
  }

  // ---------- Render ----------
  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <span className="text-gray-400">加载中...</span>
      </div>
    )
  }

  if (!app) {
    return (
      <div className="flex items-center justify-center py-20">
        <span className="text-red-500">APP不存在或已删除</span>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* ===== Top bar ===== */}
      <div>
        <button
          type="button"
          onClick={() => navigate(`/systems/${app.system_id}`)}
          className="text-sm text-gray-500 hover:text-indigo-600 mb-2 inline-flex items-center gap-1"
        >
          <span aria-hidden="true">&larr;</span> 返回系统
        </button>

        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-gray-900 truncate">{app.name}</h1>
          </div>

          {isAdminOrCreator && (
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={handleTriggerIndex}
                disabled={submitting}
                className="px-4 py-2 text-sm rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 cursor-pointer"
              >
                触发索引
              </button>
              <button
                type="button"
                onClick={openEditDialog}
                className="px-4 py-2 text-sm rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 cursor-pointer"
              >
                编辑
              </button>
              <button
                type="button"
                onClick={() => setShowDelete(true)}
                className="px-4 py-2 text-sm rounded-lg border border-red-300 text-red-600 hover:bg-red-50 cursor-pointer"
              >
                删除
              </button>
            </div>
          )}
        </div>

        {/* Info grid */}
        <div className="mt-4 grid grid-cols-2 gap-4">
          <div className="bg-white rounded-lg shadow-sm p-4">
            <span className="text-xs text-gray-500">Git地址</span>
            <p className="text-sm text-gray-900 mt-1 break-all">{app.git_url}</p>
          </div>
          <div className="bg-white rounded-lg shadow-sm p-4">
            <span className="text-xs text-gray-500">技术栈</span>
            <p className="text-sm text-gray-900 mt-1">{app.tech_stack || '-'}</p>
          </div>
          <div className="bg-white rounded-lg shadow-sm p-4">
            <span className="text-xs text-gray-500">负责人</span>
            <p className="text-sm text-gray-900 mt-1">{app.owner || '-'}</p>
          </div>
          <div className="bg-white rounded-lg shadow-sm p-4">
            <span className="text-xs text-gray-500">跟踪分支</span>
            <p className="text-sm text-gray-900 mt-1">{app.tracked_branch || '-'}</p>
          </div>
          <div className="bg-white rounded-lg shadow-sm p-4">
            <span className="text-xs text-gray-500">索引状态</span>
            <div className="mt-1">
              <StatusBadge status={app.index_status as App['index_status']} />
            </div>
          </div>
          <div className="bg-white rounded-lg shadow-sm p-4">
            <span className="text-xs text-gray-500">最后索引时间</span>
            <p className="text-sm text-gray-900 mt-1">{formatDateTime(app.last_indexed_at)}</p>
          </div>
        </div>
      </div>

      {/* ===== Tabs ===== */}
      <div className="border-b border-gray-200 relative">
        <nav className="-mb-px flex gap-6" aria-label="Tabs">
          {(['wiki', 'docs'] as TabKey[]).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab
                  ? 'text-indigo-600 border-indigo-600'
                  : 'text-gray-500 border-transparent hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              {tab === 'wiki' ? 'Wiki' : '文档管理'}
            </button>
          ))}
        </nav>
      </div>

      {/* ===== Wiki Tab ===== */}
      {activeTab === 'wiki' && (
        <div>
          {app.index_status !== 'success' ? (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-6 text-center">
              <p className="text-amber-700 text-sm">请先完成索引后再查看 Wiki</p>
            </div>
          ) : (
            <iframe
              src={`/api/v1/apps/${app.id}/wiki-page?token=${encodeURIComponent(localStorage.getItem('access_token') || '')}`}
              className="w-full border border-gray-200 rounded-lg bg-white"
              style={{ height: 'calc(100vh - 200px)', minHeight: 600 }}
              title="Wiki"
            />
          )}
        </div>
      )}

      {/* ===== Documents Tab ===== */}
      {activeTab === 'docs' && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">文档管理</h2>
            {isAdminOrCreator && (
              <button
                type="button"
                onClick={() => {
                  setDocFile(null)
                  setDocTitle('')
                  setShowUploadDoc(true)
                }}
                className="px-4 py-2 text-sm rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 cursor-pointer"
              >
                上传文档
              </button>
            )}
          </div>

          {docs.length === 0 ? (
            <div className="text-center py-12 text-gray-400">暂无文档</div>
          ) : (
            <div className="bg-white rounded-lg shadow-sm overflow-hidden">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      文件名
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      大小
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      上传时间
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                      操作
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {docs.map((doc, i) => (
                    <tr key={doc.id} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                      <td className="px-4 py-3 text-sm text-gray-900">
                        <div className="flex items-center gap-2">
                          <svg
                            className="w-4 h-4 text-gray-400 shrink-0"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={2}
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                            />
                          </svg>
                          <span className="truncate">{doc.file_name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500 whitespace-nowrap">
                        {formatFileSize(doc.file_size)}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500 whitespace-nowrap">
                        {formatDateTime(doc.created_at)}
                      </td>
                      <td className="px-4 py-3 text-sm text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => downloadFile(doc.id)}
                          className="text-indigo-600 hover:text-indigo-800 mr-3 cursor-pointer"
                        >
                          下载
                        </button>
                        {isAdminOrCreator && (
                          <button
                            type="button"
                            onClick={() => setDeletingDoc(doc)}
                            className="text-red-500 hover:text-red-700 cursor-pointer"
                          >
                            删除
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ===== Edit App Modal ===== */}
      {showEdit && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl max-w-lg w-full p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">编辑APP</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Git地址 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={editGitUrl}
                  onChange={(e) => setEditGitUrl(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">技术栈</label>
                <select
                  value={editTechStack}
                  onChange={(e) => setEditTechStack(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="">请选择</option>
                  {TECH_STACK_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
                {editTechStack === '其他' && (
                  <input
                    type="text"
                    value={editTechStackCustom}
                    onChange={(e) => setEditTechStackCustom(e.target.value)}
                    placeholder="请输入技术栈"
                    className="mt-2 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">负责人</label>
                <input
                  type="text"
                  value={editOwner}
                  onChange={(e) => setEditOwner(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">跟踪分支</label>
                <input
                  type="text"
                  value={editBranch}
                  onChange={(e) => setEditBranch(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button
                type="button"
                onClick={() => setShowEdit(false)}
                className="px-4 py-2 text-sm rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 cursor-pointer"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleEdit}
                disabled={submitting || !editGitUrl.trim()}
                className="px-4 py-2 text-sm rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 cursor-pointer"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== Index Mode Dialog ===== */}
      {showIndexDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl max-w-md w-full mx-4 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">触发索引</h3>
            <p className="text-sm text-gray-600 mb-4">请选择索引模式：</p>
            <div className="space-y-3">
              <label className="flex items-start gap-3 p-3 rounded-lg border border-gray-200 cursor-pointer hover:bg-gray-50">
                <input
                  type="radio"
                  name="indexMode"
                  checked={!indexForce}
                  onChange={() => setIndexForce(false)}
                  className="mt-0.5"
                />
                <div>
                  <span className="text-sm font-medium text-gray-900">增量更新</span>
                  <p className="text-xs text-gray-500 mt-0.5">只处理变更部分，速度更快</p>
                </div>
              </label>
              <label className="flex items-start gap-3 p-3 rounded-lg border border-gray-200 cursor-pointer hover:bg-gray-50">
                <input
                  type="radio"
                  name="indexMode"
                  checked={indexForce}
                  onChange={() => setIndexForce(true)}
                  className="mt-0.5"
                />
                <div>
                  <span className="text-sm font-medium text-gray-900">强制全量</span>
                  <p className="text-xs text-gray-500 mt-0.5">全量重新分析和生成 Wiki</p>
                </div>
              </label>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button
                type="button"
                onClick={() => setShowIndexDialog(false)}
                className="px-4 py-2 text-sm rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 cursor-pointer"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleConfirmIndex}
                className="px-4 py-2 text-sm rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 cursor-pointer"
              >
                确认
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== Delete Confirm ===== */}
      {showDelete && (
        <ConfirmDialog
          open={showDelete}
          title="确认删除APP"
          message="确认删除该APP？此操作不可恢复！删除后网盘里的代码仓库会被删除。"
          confirmLabel="删除"
          danger
          onConfirm={handleDelete}
          onCancel={() => setShowDelete(false)}
        />
      )}

      {/* ===== Upload Document Modal ===== */}
      {showUploadDoc && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl max-w-lg w-full p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">上传文档</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  选择文件 <span className="text-red-500">*</span>
                </label>
                <input
                  type="file"
                  onChange={(e) => setDocFile(e.target.files?.[0] ?? null)}
                  className="w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">文档标题</label>
                <input
                  type="text"
                  value={docTitle}
                  onChange={(e) => setDocTitle(e.target.value)}
                  placeholder="留空则使用文件名"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button
                type="button"
                onClick={() => setShowUploadDoc(false)}
                className="px-4 py-2 text-sm rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 cursor-pointer"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleUploadDoc}
                disabled={submitting || !docFile}
                className="px-4 py-2 text-sm rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 cursor-pointer"
              >
                上传
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== Delete Doc Confirm ===== */}
      {deletingDoc && (
        <ConfirmDialog
          open={!!deletingDoc}
          title="确认删除文档"
          message={`确认删除文档「${deletingDoc.file_name}」？`}
          confirmLabel="删除"
          danger
          onConfirm={() => handleDeleteDoc(deletingDoc)}
          onCancel={() => setDeletingDoc(null)}
        />
      )}
    </div>
  )
}
