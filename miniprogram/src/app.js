import { setupPlatform } from './platform'

// 注入必须在任何页面渲染前完成：逻辑层的配置是模块级可变对象
setupPlatform()

export default function App({ children }) {
  return children
}
