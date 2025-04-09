import { Readability } from '@mozilla/readability'
import { nanoid } from '@reduxjs/toolkit'
import { WebSearchProvider, WebSearchResponse, WebSearchResult } from '@renderer/types'
import TurndownService from 'turndown'
import { URL } from 'url'

import BaseWebSearchProvider from './BaseWebSearchProvider'

export default class LocalSearchProvider extends BaseWebSearchProvider {
  private turndownService: TurndownService = new TurndownService()

  constructor(provider: WebSearchProvider) {
    if (!provider || !provider.url) {
      throw new Error('Provider URL is required')
    }
    super(provider)
  }

  public async search(
    query: string,
    maxResults: number = 15,
    excludeDomains: string[] = []
  ): Promise<WebSearchResponse> {
    try {
      if (!query.trim()) {
        throw new Error('Search query cannot be empty')
      }
      if (!this.provider.url) {
        throw new Error('Provider URL is required')
      }

      excludeDomains.push(new URL(this.provider.url).host)

      const cleanedQuery = query.split('\r\n')[1] ?? query
      const url = this.provider.url.replace('%s', encodeURIComponent(cleanedQuery))
      // const url = 'https://www.google.com/search?q=' + encodeURIComponent(cleanedQuery)

      const content = await window.api.searchService.openUrlInSearchWindow(nanoid(), url!)

      // Parse the content to extract URLs and metadata
      const { urls } = this.parseHtmlContent(content)

      // Filter out Google URLs
      const uniqueUrls = [...new Set(urls)]
      const validUrls = uniqueUrls.filter(
        (url) => !url.includes('google.com') && !excludeDomains.some((domain) => url.includes(domain))
      )
      console.log('Valid URLs:', validUrls)

      // Limit to maxResults
      const urlsToVisit = validUrls.slice(0, maxResults)

      // Fetch content for each URL concurrently
      const fetchPromises = urlsToVisit.map(async (currentUrl) => {
        console.log(`Fetching content for ${currentUrl}...`)
        const result = await this.fetchPageContent(currentUrl, this.provider.usingBrowser)
        if (
          this.provider.contentLimit &&
          this.provider.contentLimit != -1 &&
          result.content.length > this.provider.contentLimit
        ) {
          result.content = result.content.slice(0, this.provider.contentLimit) + '...'
        }
        return result
      })

      // Wait for all fetches to complete
      const results: WebSearchResult[] = await Promise.all(fetchPromises)

      return {
        query: query,
        results: results.filter((result) => result.content != 'Error fetching content')
      }
    } catch (error) {
      console.error('Tavily search failed:', error)
      throw new Error(`Search failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  private async fetchPageContent(url: string, usingBrowser: boolean = false): Promise<WebSearchResult> {
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 30000) // 30 second timeout

      let html: string
      if (usingBrowser) {
        html = await window.api.searchService.openUrlInSearchWindow(`search-window-${nanoid()}`, url)
      } else {
        const response = await fetch(url, {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
          },
          signal: controller.signal
        })
        if (!response.ok) {
          throw new Error(`HTTP error: ${response.status}`)
        }
        html = await response.text()
      }

      clearTimeout(timeoutId) // Clear the timeout if fetch completes successfully
      const parser = new DOMParser()
      const doc = parser.parseFromString(html, 'text/html')
      const article = new Readability(doc).parse()
      console.log('Parsed article:', article)
      const markdown = this.turndownService.turndown(article?.content || '')
      return {
        title: article?.title || url,
        url: url,
        content: markdown || 'Error fetching content'
      }
    } catch (e: unknown) {
      console.error(`Failed to fetch ${url}`, e)
      return {
        title: url,
        url: url,
        content: 'Error fetching content'
      }
    }
  }

  private parseHtmlContent(htmlContent: string): { urls: string[]; metadata: Record<string, string> } {
    const urls: string[] = []
    const metadata: Record<string, string> = {}

    try {
      // Parse HTML string into a DOM document
      const parser = new DOMParser()
      const doc = parser.parseFromString(htmlContent, 'text/html')

      // Extract URLs from all anchor tags
      const links = doc.querySelectorAll('a')
      links.forEach((link) => {
        const href = link.getAttribute('href')
        if (href && href.startsWith('http')) {
          urls.push(href)
        }
      })

      // Extract metadata from meta tags
      const metaTags = doc.querySelectorAll('meta')
      metaTags.forEach((meta) => {
        const name = meta.getAttribute('name') || meta.getAttribute('property')
        const content = meta.getAttribute('content')
        if (name && content) {
          metadata[name] = content
        }
      })

      // Extract title
      const title = doc.querySelector('title')
      if (title && title.textContent) {
        metadata['title'] = title.textContent
      }
    } catch (error) {
      console.error('Error parsing HTML content:', error)
    }

    return { urls, metadata }
  }
}
