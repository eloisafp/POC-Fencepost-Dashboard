'use client'

import { useState, useEffect, useRef } from 'react'
import TemplateManager from './TemplateEditor'
import BulkGenerator from './BulkGenerator'

declare const google: any

export default function PageGeneratorPage() {
  const [view, setView] = useState<'service-location' | 'service-only' | 'templates'>('service-location')

  const tokenClientRef    = useRef<any>(null)
  const accessTokenRef    = useRef<string>('')
  const pickerCallbackRef = useRef<((id: string, name: string) => void) | null>(null)

  useEffect(() => {
    const gapiScript = document.createElement('script')
    gapiScript.src   = 'https://apis.google.com/js/api.js'
    gapiScript.onload = () => { (window as any).gapi.load('picker', () => {}) }
    document.body.appendChild(gapiScript)

    const gisScript = document.createElement('script')
    gisScript.src   = 'https://accounts.google.com/gsi/client'
    gisScript.onload = () => {
      tokenClientRef.current = google.accounts.oauth2.initTokenClient({
        client_id: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID!,
        scope: 'https://www.googleapis.com/auth/drive.readonly',
        callback: (resp: any) => {
          if (resp.access_token) {
            accessTokenRef.current = resp.access_token
            showPicker(resp.access_token)
          }
        },
      })
    }
    document.body.appendChild(gisScript)
  }, [])

  function showPicker(token: string) {
    const picker = new google.picker.PickerBuilder()
      .addView(
        new google.picker.DocsView()
          .setIncludeFolders(true)
          .setSelectFolderEnabled(true)
          .setMimeTypes('application/vnd.google-apps.folder')
      )
      .setOAuthToken(token)
      .setDeveloperKey(process.env.NEXT_PUBLIC_GOOGLE_API_KEY!)
      .setCallback((data: any) => {
        if (data.action === google.picker.Action.PICKED) {
          const folder = data.docs[0]
          if (pickerCallbackRef.current) pickerCallbackRef.current(folder.id, folder.name)
        }
      })
      .build()
    picker.setVisible(true)
  }

  function openDrivePicker(onSelect: (id: string, name: string) => void) {
    pickerCallbackRef.current = onSelect
    if (!tokenClientRef.current) return
    if (accessTokenRef.current) {
      showPicker(accessTokenRef.current)
    } else {
      tokenClientRef.current.requestAccessToken({ prompt: 'consent' })
    }
  }

  return (
    <div className="p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-base font-semibold text-gray-800 tracking-tight">Page Generator</h1>
          <p className="text-xs text-gray-400 mt-0.5">Generate SEO service and location pages for client review</p>
        </div>
        <div className="flex bg-gray-100 rounded-lg p-0.5 gap-0.5">
          {([
            { key: 'service-location', label: 'Service + Location' },
            { key: 'service-only',     label: 'Service Only'       },
            { key: 'templates',        label: 'Templates'          },
          ] as const).map(({ key, label }) => (
            <button key={key} onClick={() => setView(key)}
              className={`text-xs px-3.5 py-1.5 rounded-md transition-all ${view === key ? 'bg-white shadow-sm text-gray-800 font-medium' : 'text-gray-500 hover:text-gray-700'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {view === 'templates'        && <TemplateManager />}
      {view === 'service-location' && <BulkGenerator mode="service-location" openDrivePicker={openDrivePicker} />}
      {view === 'service-only'     && <BulkGenerator mode="service-only"     openDrivePicker={openDrivePicker} />}
    </div>
  )
}
