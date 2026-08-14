import { useState, useEffect } from 'react'
import { X, Loader2, CheckCircle2, XCircle, AlertCircle } from 'lucide-react'
import { getEnvParam, saveEnvParam, testEnvParam } from '../api/client'

const FIELD_DEFS = [
  { key: 'sessdata', label: 'sessdata', placeholder: 'B站 sessdata' },
  { key: 'bili_jct', label: 'bili_jct', placeholder: 'B站 bili_jct' },
  { key: 'buvid3', label: 'buvid3', placeholder: 'B站 buvid3' },
  { key: 'model', label: '模型', placeholder: '如 deepseek-v4-flash' },
  { key: 'base_url', label: 'API 地址', placeholder: '如 https://api.deepseek.com' },
  { key: 'api_key', label: 'API Key', placeholder: 'LLM API Key', secret: true },
]

export default function EnvConfigModal({ onClose, onSaved }) {
  const [form, setForm] = useState({
    sessdata: '', bili_jct: '', buvid3: '',
    model: '', base_url: '', api_key: '',
  })
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState(null)
  const [saving, setSaving] = useState(false)

  // Load existing values on open
  useEffect(() => {
    getEnvParam()
      .then((params) => setForm((f) => ({ ...f, ...params })))
      .catch(() => {})
  }, [])

  const handleChange = (key, value) => {
    setForm((f) => ({ ...f, [key]: value }))
    setTestResult(null)
  }

  const validate = () => {
    const emptyFields = FIELD_DEFS.filter((fld) => !form[fld.key]?.trim())
    if (emptyFields.length > 0) {
      return {
        ok: false,
        msg: `请填写：${emptyFields.map((f) => f.label).join('、')}`,
      }
    }
    return { ok: true }
  }

  const handleTest = async () => {
    const v = validate()
    if (!v.ok) {
      setTestResult(v)
      return
    }

    setTesting(true)
    setTestResult(null)
    try {
      await testEnvParam(form)
      setTestResult({ ok: true, msg: '环境变量测试成功' })
    } catch (err) {
      const detail = err?.response?.data?.detail || '测试失败'
      setTestResult({ ok: false, msg: detail })
    } finally {
      setTesting(false)
    }
  }

  const handleSave = async () => {
    const v = validate()
    if (!v.ok) {
      setTestResult(v)
      return
    }

    setSaving(true)
    try {
      await saveEnvParam(form)
      onSaved(testResult?.ok || false)
    } catch (err) {
      const detail = err?.response?.data?.detail || '保存失败'
      setTestResult({ ok: false, msg: detail })
    } finally {
      setSaving(false)
    }
  }

  const isTestedOk = testResult?.ok === true
  const isValidationError = testResult && !testResult.ok && testResult.msg?.startsWith('请填写')

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="bg-white shadow-2xl w-full max-w-md mx-4 overflow-hidden rounded-2xl
                   border border-black/10 animate-in"
        style={{ animation: 'scaleIn 0.2s ease-out' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-black/5">
          <div>
            <h2 className="text-base font-semibold text-warm-900">环境变量配置</h2>
            <p className="text-[11px] text-warm-400 mt-0.5">
              前三个参数用于获取视频信息，后三个参数用于 LLM
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg
                       text-warm-400 hover:text-warm-700 hover:bg-warm-100 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Form */}
        <div className="px-6 py-4 space-y-3.5 max-h-[420px] overflow-y-auto">
          {/* Error / validation banner — fixed at top */}
          {testResult && !testResult.ok && (
            <div className="flex items-start gap-2 px-3 py-2.5 text-sm rounded-lg
                            bg-red-50 text-red-600 border border-red-200 sticky top-0 z-10">
              {isValidationError
                ? <AlertCircle size={16} className="shrink-0 mt-0.5" />
                : <XCircle size={16} className="shrink-0 mt-0.5" />}
              <span>{testResult.msg}</span>
            </div>
          )}

          {/* Success banner */}
          {testResult && testResult.ok && (
            <div className="flex items-center gap-2 px-3 py-2.5 text-sm rounded-lg
                            bg-green-50 text-green-700 border border-green-200">
              <CheckCircle2 size={16} />
              <span>{testResult.msg}</span>
            </div>
          )}

          {FIELD_DEFS.map((fld) => (
            <div key={fld.key}>
              <label className="block text-xs font-medium text-warm-500 mb-1">
                {fld.label}
              </label>
              <input
                type={fld.secret ? 'password' : 'text'}
                value={form[fld.key] || ''}
                onChange={(e) => handleChange(fld.key, e.target.value)}
                placeholder={fld.placeholder}
                className="w-full px-3 py-2 text-sm border border-black/10 rounded-lg
                           bg-[#f7f6f3] text-warm-900 placeholder:text-warm-300
                           focus:border-accent-400 focus:ring-2 focus:ring-accent-50
                           transition-colors"
              />
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-black/5 bg-[#faf9f6]">
          <div className="flex gap-3">
            <button
              onClick={handleTest}
              disabled={testing}
              className="flex-1 py-2.5 text-sm font-medium rounded-lg
                         border border-blue-400 text-blue-600
                         hover:bg-blue-50 active:scale-[0.98]
                         disabled:opacity-50 transition-all
                         flex items-center justify-center gap-2"
            >
              {testing && <Loader2 size={14} className="animate-spin" />}
              {testing ? '测试中...' : '测试连接'}
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex-1 py-2.5 text-sm font-medium text-white rounded-lg
                         bg-blue-600 hover:bg-blue-700
                         active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed
                         transition-all flex items-center justify-center gap-2"
            >
              {saving && <Loader2 size={14} className="animate-spin" />}
              {saving ? '保存中...' : isTestedOk ? '保存并关闭' : '直接保存'}
            </button>
          </div>
          {!isTestedOk && (
            <p className="mt-2 text-[11px] text-warm-400 text-center">
              💡 建议先「测试连接」成功后再保存，确保配置可用
            </p>
          )}
        </div>
      </div>

      <style>{`
        @keyframes scaleIn {
          from { opacity: 0; transform: scale(0.95); }
          to { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  )
}
