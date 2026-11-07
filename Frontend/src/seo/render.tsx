import { renderToStaticMarkup, renderToString } from 'react-dom/server'
import { StrictMode } from 'react'
import { App } from '../App'
import { assertCatalogItem } from '../lib/catalogValidation'
export { DirectoryPage, GenrePage, GuidePage, WorkPage, AboutPage, MethodologyPage, NotFoundPage } from './pages'
export { site, editorials, genres, guides, workPath } from './content'
export { renderToStaticMarkup, assertCatalogItem }
export const renderHome = () => renderToString(<StrictMode><App /></StrictMode>)
