import { nanoid } from '@reduxjs/toolkit'
import { WebSearchProvider, WebSearchResponse, WebSearchResult } from '@renderer/types'
import TurndownService from 'turndown'

import BaseWebSearchProvider from './BaseWebSearchProvider'

export default class DefaultProvider extends BaseWebSearchProvider {
  private turndownService: TurndownService = new TurndownService()
  private contentLimit: number
  private usingBrowser: boolean

  constructor(provider: WebSearchProvider) {
    super(provider)
    this.usingBrowser = provider.usingBrowser ?? false
    this.contentLimit = provider.contentLimit ?? 10000
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
      const cleanedQuery = query.split('\r\n')[1] ?? query
      const url = 'https://www.google.com/search?q=' + encodeURIComponent(cleanedQuery)

      const content = await window.api.searchService.openUrlInSearchWindow(nanoid(), url)

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
        // Use fetchPageContentByBrowser to fetch the content
        let result: WebSearchResult
        if (this.usingBrowser) {
          result = await this.fetchPageContentByBrowser(currentUrl)
        } else {
          result = await this.fetchPageContent(currentUrl)
        }
        // console.log(`Fetched content for ${currentUrl}:`, result)
        if (result.content.length > this.contentLimit) {
          result.content = result.content.slice(0, this.contentLimit) + '...'
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

  private async fetchPageContent(url: string): Promise<WebSearchResult> {
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 30000) // 30 second timeout

      const response = await fetch(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        },
        signal: controller.signal
      })

      clearTimeout(timeoutId) // Clear the timeout if fetch completes successfully

      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status}`)
      }
      const html = await response.text()
      const markdown = this.turndownService.turndown(html)
      return {
        title: this.extractTitleFromContent(html) || url,
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

  private async fetchPageContentByBrowser(url: string): Promise<WebSearchResult> {
    try {
      const response = await window.api.searchService.openUrlInSearchWindow(`search-window-${nanoid()}`, url)
      const markdown = this.turndownService.turndown(response)
      return {
        title: this.extractTitleFromContent(response) || url,
        url: url,
        content: markdown || 'no content'
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
  private extractTitleFromContent(htmlContent: string): string | null {
    try {
      const parser = new DOMParser()
      const doc = parser.parseFromString(htmlContent, 'text/html')
      const titleElement = doc.querySelector('title')
      return titleElement?.textContent || null
    } catch {
      return null
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
