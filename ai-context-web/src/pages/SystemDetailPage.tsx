import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { getSystem, updateSystem, deleteSystem, updateGitlabCredentials } from '../api/systems'
import type { System, App } from '../api/systems'
import { createApp, deleteApp } from '../api/apps'
import { triggerIndex, cancelIndex, getIndexStatus } from '../api/index'
import { listSystemDocs, deleteDocument, downloadFile, uploadDocument } from '../api/documents'
import type { Document } from '../api/documents'
import { getSystemIndexStatus } from '../api/index'
import type { SystemIndexStatus } from '../api/index'
import StatusBadge from '../components/StatusBadge'
import ConfirmDialog from '../components/ConfirmDialog'

type TabKey = 'apps' | 'docs'

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

export default function SystemDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user } = useAuth()

  const [system, setSystem] = useState<System | null>(null)
  const [apps, setApps] = useState<App[]>([])
  const [docs, setDocs] = useState<Document[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<TabKey>('apps')

  // Dialog states
  const [showEditSystem, setShowEditSystem] = useState(false)
  const [showDeleteSystem, setShowDeleteSystem] = useState(false)
  const [deleteSystemStep, setDeleteSystemStep] = useState<1 | 2>(1)
  const [deleteConfirmName, setDeleteConfirmName] = useState('')
  const [showGitlabCreds, setShowGitlabCreds] = useState(false)
  const [showCreateApp, setShowCreateApp] = useState(false)
  const [showUploadDoc, setShowUploadDoc] = useState(false)
  const [deletingApp, setDeletingApp] = useState<App | null>(null)
  const [deletingDoc, setDeletingDoc] = useState<Document | null>(null)
  const [indexStatus, setIndexStatus] = useState<SystemIndexStatus | null>(null)
  const [showIndexDialog, setShowIndexDialog] = useState(false)
  const [indexingApp, setIndexingApp] = useState<App | null>(null)
  const [indexForce, setIndexForce] = useState(false)

  // Edit system form
  const [editName, setEditName] = useState('')
  const [editDesc, setEditDesc] = useState('')
  const [editOwner, setEditOwner] = useState('')

  // GitLab credentials form
  const [gitlabUser, setGitlabUser] = useState('')
  const [gitlabToken, setGitlabToken] = useState('')

  // Create app form
  const [appName, setAppName] = useState('')
  const [appGitUrl, setAppGitUrl] = useState('')
  const [appTechStack, setAppTechStack] = useState('')
  const [appTechStackCustom, setAppTechStackCustom] = useState('')
  const [appBranch, setAppBranch] = useState('main')
  const [appOwner, setAppOwner] = useState('')

  // Upload doc form
  const [docFile, setDocFile] = useState<File | null>(null)
  const [docTitle, setDocTitle] = useState('')

  const [submitting, setSubmitting] = useState(false)

  const isAdminOrCreator =
    !!user && !!system && (user.role === 'admin' || user.id === system.created_by)

  // ---------- Data loading ----------
  const loadSystem = async () => {
    if (!id) return
    setLoading(true)
    try {
      const sys = await getSystem(id)
      setSystem(sys)
      setApps(sys.apps ?? [])
      try {
        const status = await getSystemIndexStatus(id)
        setIndexStatus(status)
      } catch {
        /* ignore */
      }
    } finally {
      setLoading(false)
    }
  }

  const loadDocs = async () => {
    if (!id) return
    try {
      const list = await listSystemDocs(id)
      setDocs(list)
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    loadSystem()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  useEffect(() => {
    if (activeTab === 'docs') loadDocs()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab])

  // ---------- Handlers ----------
  const handleEditSystem = async () => {
    if (!id || submitting) return
    setSubmitting(true)
    try {
      const updated = await updateSystem(id, {
        name: editName,
        description: editDesc,
        owner: editOwner,
      })
      setSystem(updated)
      setShowEditSystem(false)
    } finally {
      setSubmitting(false)
    }
  }

  const handleDeleteSystem = async () => {
    if (!id || submitting) return
    if (deleteConfirmName !== system?.name) return
    setSubmitting(true)
    try {
      await deleteSystem(id, deleteConfirmName)
      navigate('/')
    } finally {
      setSubmitting(false)
    }
  }

  const handleUpdateGitlabCreds = async () => {
    if (!id || submitting) return
    setSubmitting(true)
    try {
      const updated = await updateGitlabCredentials(id, gitlabUser, gitlabToken)
      setSystem(updated)
      setShowGitlabCreds(false)
    } finally {
      setSubmitting(false)
    }
  }

  const handleCreateApp = async () => {
    if (!id || submitting) return
    setSubmitting(true)
    try {
      const tech =
        appTechStack === '其他' ? appTechStackCustom : appTechStack
      const created = await createApp(id, {
        name: appName,
        git_url: appGitUrl,
        tracked_branch: appBranch,
        tech_stack: tech || undefined,
        owner: appOwner || undefined,
      })
      setApps((prev) => [...prev, created])
      setShowCreateApp(false)
      resetAppForm()
    } finally {
      setSubmitting(false)
    }
  }

  const handleDeleteApp = async (app: App) => {
    if (submitting) return
    setSubmitting(true)
    try {
      await deleteApp(app.id)
      setApps((prev) => prev.filter((a) => a.id !== app.id))
      setDeletingApp(null)
    } finally {
      setSubmitting(false)
    }
  }

  const handleTriggerIndex = (app: App) => {
    setIndexingApp(app)
    setIndexForce(false)
    setShowIndexDialog(true)
  }

  const handleConfirmIndex = async () => {
    if (!indexingApp) return
    setShowIndexDialog(false)
    try {
      const result = await triggerIndex(indexingApp.id, true, indexForce)
      navigate(`/apps/${indexingApp.id}/index/${result.job_id}`)
    } catch {
      /* ignore */
    }
  }

  const handleCancelIndex = async (app: App) => {
    try {
      await cancelIndex(app.id)
      await loadSystem()
    } catch {
      /* ignore */
    }
  }

  const handleViewProgress = async (app: App) => {
    try {
      const status = await getIndexStatus(app.id)
      if (status.current_job_id) {
        navigate(`/apps/${app.id}/index/${status.current_job_id}`)
      }
    } catch {
      /* ignore */
    }
  }

  const handleUploadDoc = async () => {
    if (!id || !docFile || submitting) return
    setSubmitting(true)
    try {
      await uploadDocument(`/systems/${id}/documents`, docFile, 'general', docTitle || docFile.name)
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

  const resetAppForm = () => {
    setAppName('')
    setAppGitUrl('')
    setAppTechStack('')
    setAppTechStackCustom('')
    setAppBranch('main')
    setAppOwner('')
  }

  // ---------- Dialog open helpers ----------
  const openEditSystem = () => {
    if (!system) return
    setEditName(system.name)
    setEditDesc(system.description ?? '')
    setEditOwner(system.owner ?? '')
    setShowEditSystem(true)
  }

  const openDeleteSystem = () => {
    setDeleteSystemStep(1)
    setDeleteConfirmName('')
    setShowDeleteSystem(true)
  }

  const openGitlabCreds = () => {
    setGitlabUser(system?.gitlab_username ?? '')
    setGitlabToken('')
    setShowGitlabCreds(true)
  }

  // ---------- Render ----------
  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <span className="text-gray-400">加载中...</span>
      </div>
    )
  }

  if (!system) {
    return (
      <div className="flex items-center justify-center py-20">
        <span className="text-red-500">系统不存在或已删除</span>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* ===== Top bar ===== */}
      <div>
        <button
          type="button"
          onClick={() => navigate('/')}
          className="text-sm text-gray-500 hover:text-indigo-600 mb-2 inline-flex items-center gap-1"
        >
          <span aria-hidden="true">&larr;</span> 返回列表
        </button>

        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-gray-900 truncate">{system.name}</h1>
            {system.description && (
              <p className="mt-1 text-gray-600 text-sm">{system.description}</p>
            )}
            <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm text-gray-500">
              {system.owner && <span>负责人：{system.owner}</span>}
              {system.gitlab_username && (
                <span>
                  GitLab：{system.gitlab_username} / ********
                </span>
              )}
            </div>
          </div>

          {isAdminOrCreator && (
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={openEditSystem}
                className="px-4 py-2 text-sm rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50"
              >
                编辑系统
              </button>
              <button
                type="button"
                onClick={openDeleteSystem}
                className="px-4 py-2 text-sm rounded-lg border border-red-300 text-red-600 hover:bg-red-50"
              >
                删除系统
              </button>
              <button
                type="button"
                onClick={openGitlabCreds}
                className="px-4 py-2 text-sm rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50"
              >
                修改GitLab凭证
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ===== Tabs ===== */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex gap-6" aria-label="Tabs">
          {(['apps', 'docs'] as TabKey[]).map((tab) => (
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
              {tab === 'apps' ? 'APP列表' : '文档管理'}
            </button>
          ))}
        </nav>
      </div>

      {/* ===== APP List Tab ===== */}
      {activeTab === 'apps' && (
        <div>
          {/* 全局索引状态感知栏 */}
          {indexStatus && (indexStatus.running_count > 0 || indexStatus.pending_count > 0 || indexStatus.recent_completed) && (
            <div className="bg-indigo-50 border border-indigo-100 rounded-lg px-4 py-3 mb-4 flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
              <span className="text-indigo-700 font-medium">
                当前运行: {indexStatus.running_count}/{indexStatus.max_concurrent}
              </span>
              {indexStatus.pending_count > 0 && (
                <span className="text-amber-700">
                  排队中: {indexStatus.pending_count}
                </span>
              )}
              {indexStatus.recent_completed && (
                <span className="text-gray-600">
                  最近完成: {apps.find(a => a.id === indexStatus.recent_completed!.app_id)?.name ?? indexStatus.recent_completed.app_id}
                  <span className={indexStatus.recent_completed.status === 'success' ? 'text-emerald-600' : 'text-red-500'}>
                    ({indexStatus.recent_completed.status === 'success' ? '成功' : '失败'})
                  </span>
                </span>
              )}
              {indexStatus.running_count >= indexStatus.max_concurrent && (
                <span className="text-amber-600 text-xs">
                  当前索引队列已满，新任务将加入等待队列
                </span>
              )}
            </div>
          )}
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">APP列表</h2>
            {isAdminOrCreator && (
              <button
                type="button"
                onClick={() => {
                  resetAppForm()
                  setShowCreateApp(true)
                }}
                className="px-4 py-2 text-sm rounded-lg bg-indigo-600 text-white hover:bg-indigo-700"
              >
                新建APP
              </button>
            )}
          </div>

          {apps.length === 0 ? (
            <div className="text-center py-12 text-gray-400">暂无APP</div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {apps.map((app) => (
                <div
                  key={app.id}
                  className="bg-white rounded-lg shadow-sm p-4 flex flex-col gap-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => navigate(`/apps/${app.id}`)}
                      className="font-medium text-gray-900 hover:text-indigo-600 truncate"
                    >
                      {app.name}
                    </button>
                    <StatusBadge status={app.index_status} />
                  </div>
                  <p className="text-sm text-gray-500 truncate" title={app.git_url}>
                    {app.git_url}
                  </p>
                  {app.tech_stack && (
                    <span className="inline-block self-start text-xs px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700">
                      {app.tech_stack}
                    </span>
                  )}
                  <p className="text-xs text-gray-400">
                    最后索引：{formatDateTime(app.last_indexed_at)}
                  </p>

                  <div className="flex items-center gap-2 mt-auto pt-2 border-t border-gray-100">
                    <button
                      type="button"
                      onClick={() => navigate(`/apps/${app.id}`)}
                      className="text-sm text-indigo-600 hover:text-indigo-800"
                    >
                      查看详情
                    </button>
                    {app.index_status === 'pending' || app.index_status === 'running' ? (
                      <>
                        <button
                          type="button"
                          onClick={() => handleViewProgress(app)}
                          className="text-sm text-indigo-600 hover:text-indigo-800"
                        >
                          查看进度
                        </button>
                        {isAdminOrCreator && (
                          <button
                            type="button"
                            onClick={() => handleCancelIndex(app)}
                            className="text-sm text-red-500 hover:text-red-700"
                          >
                            取消索引
                          </button>
                        )}
                      </>
                    ) : (
                      <>
                        {isAdminOrCreator && (
                          <button
                            type="button"
                            onClick={() => handleTriggerIndex(app)}
                            className="text-sm text-indigo-600 hover:text-indigo-800"
                          >
                            触发索引
                          </button>
                        )}
                        {app.index_status === 'success' && (
                          <button
                            type="button"
                            onClick={() => navigate(`/apps/${app.id}`)}
                            className="text-sm text-indigo-600 hover:text-indigo-800"
                          >
                            Wiki
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => navigate(`/apps/${app.id}`)}
                          className="text-sm text-indigo-600 hover:text-indigo-800"
                        >
                          文档
                        </button>
                      </>
                    )}
                    {isAdminOrCreator && (
                      <>
                        <button
                          type="button"
                          onClick={() => navigate(`/apps/${app.id}`)}
                          className="text-sm text-indigo-600 hover:text-indigo-800"
                        >
                          编辑
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeletingApp(app)}
                          className="text-sm text-red-500 hover:text-red-700 ml-auto"
                        >
                          删除
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
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
                className="px-4 py-2 text-sm rounded-lg bg-indigo-600 text-white hover:bg-indigo-700"
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
                          className="text-indigo-600 hover:text-indigo-800 mr-3"
                        >
                          下载
                        </button>
                        {isAdminOrCreator && (
                          <button
                            type="button"
                            onClick={() => setDeletingDoc(doc)}
                            className="text-red-500 hover:text-red-700"
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

      {/* ===== Edit System Modal ===== */}
      {showEditSystem && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl max-w-lg w-full p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">编辑系统</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">系统名称</label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">描述</label>
                <textarea
                  value={editDesc}
                  onChange={(e) => setEditDesc(e.target.value)}
                  rows={3}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
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
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button
                type="button"
                onClick={() => setShowEditSystem(false)}
                className="px-4 py-2 text-sm rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleEditSystem}
                disabled={submitting || !editName.trim()}
                className="px-4 py-2 text-sm rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== Delete System Confirm (two-step) ===== */}
      {showDeleteSystem && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl max-w-lg w-full p-6">
            {deleteSystemStep === 1 ? (
              <>
                <h3 className="text-lg font-semibold text-gray-900 mb-4">确认删除</h3>
                <p className="text-sm text-gray-600 mb-6">
                  确认删除该系统及其下属所有APP？此操作不可恢复！
                </p>
                <div className="flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => setShowDeleteSystem(false)}
                    className="px-4 py-2 text-sm rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteSystemStep(2)}
                    className="px-4 py-2 text-sm rounded-lg bg-red-600 text-white hover:bg-red-700"
                  >
                    继续
                  </button>
                </div>
              </>
            ) : (
              <>
                <h3 className="text-lg font-semibold text-red-600 mb-4">再次确认</h3>
                <p className="text-sm text-gray-600 mb-4">
                  请输入系统名称 <strong>{system.name}</strong> 以确认删除。
                  删除后，其下属 <strong>{apps.length}</strong> 个APP将被永久删除，网盘里的代码仓库也会被删除。
                </p>
                <div className="mb-6">
                  <input
                    type="text"
                    value={deleteConfirmName}
                    onChange={(e) => setDeleteConfirmName(e.target.value)}
                    placeholder={`请输入 "${system.name}"`}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-red-500"
                  />
                  {deleteConfirmName && deleteConfirmName !== system.name && (
                    <p className="mt-1 text-sm text-red-500">输入的系统名称不匹配</p>
                  )}
                </div>
                <div className="flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => setShowDeleteSystem(false)}
                    className="px-4 py-2 text-sm rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    onClick={handleDeleteSystem}
                    disabled={submitting || deleteConfirmName !== system.name}
                    className="px-4 py-2 text-sm rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
                  >
                    确认删除
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ===== GitLab Credentials Modal ===== */}
      {showGitlabCreds && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl max-w-lg w-full p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">修改GitLab凭证</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  GitLab用户名
                </label>
                <input
                  type="text"
                  value={gitlabUser}
                  onChange={(e) => setGitlabUser(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  密码 / Token
                </label>
                <input
                  type="password"
                  value={gitlabToken}
                  onChange={(e) => setGitlabToken(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button
                type="button"
                onClick={() => setShowGitlabCreds(false)}
                className="px-4 py-2 text-sm rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleUpdateGitlabCreds}
                disabled={submitting || !gitlabUser.trim() || !gitlabToken.trim()}
                className="px-4 py-2 text-sm rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== Create App Modal ===== */}
      {showCreateApp && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl max-w-lg w-full p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">新建APP</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  APP名称 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={appName}
                  onChange={(e) => setAppName(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  GitLab地址 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={appGitUrl}
                  onChange={(e) => setAppGitUrl(e.target.value)}
                  placeholder="https://gitlab.example.com/group/project.git"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">技术栈</label>
                <select
                  value={appTechStack}
                  onChange={(e) => setAppTechStack(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="">请选择</option>
                  {TECH_STACK_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
                {appTechStack === '其他' && (
                  <input
                    type="text"
                    value={appTechStackCustom}
                    onChange={(e) => setAppTechStackCustom(e.target.value)}
                    placeholder="请输入技术栈"
                    className="mt-2 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">跟踪分支</label>
                <input
                  type="text"
                  value={appBranch}
                  onChange={(e) => setAppBranch(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  负责人 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={appOwner}
                  onChange={(e) => setAppOwner(e.target.value)}
                  required
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button
                type="button"
                onClick={() => setShowCreateApp(false)}
                className="px-4 py-2 text-sm rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleCreateApp}
                disabled={submitting || !appName.trim() || !appGitUrl.trim() || !appOwner.trim()}
                className="px-4 py-2 text-sm rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                创建
              </button>
            </div>
          </div>
        </div>
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
                className="px-4 py-2 text-sm rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleUploadDoc}
                disabled={submitting || !docFile}
                className="px-4 py-2 text-sm rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                上传
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== Index Mode Dialog ===== */}
      {showIndexDialog && indexingApp && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl max-w-md w-full mx-4 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-1">触发索引</h3>
            <p className="text-sm text-gray-500 mb-4">{indexingApp.name}</p>
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
                onClick={() => { setShowIndexDialog(false); setIndexingApp(null) }}
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

      {/* ===== Delete App Confirm ===== */}
      {deletingApp && (
        <ConfirmDialog
          open={!!deletingApp}
          title="确认删除APP"
          message={`确认删除APP「${deletingApp.name}」？此操作不可恢复！`}
          confirmLabel="删除"
          danger
          onConfirm={() => handleDeleteApp(deletingApp)}
          onCancel={() => setDeletingApp(null)}
        />
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
