'use client'

import { useEffect, useState } from 'react'

const STORAGE_KEY = 'jst_sidebar_collapsed'

export function useSidebar() {
  const [collapsed, setCollapsed] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    setCollapsed(localStorage.getItem(STORAGE_KEY) === 'true')
  }, [])

  function toggle() {
    setCollapsed((prev) => {
      const next = !prev
      localStorage.setItem(STORAGE_KEY, String(next))
      return next
    })
  }

  // Antes de montar usamos false para evitar hydration mismatch
  return { collapsed: mounted ? collapsed : false, toggle }
}
