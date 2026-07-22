// 平台配置表：名称、emoji 图标、品牌色、搜索 URL 模板
// KEY 占位符会被 encodeURIComponent 后的关键词替换

export const PLATFORMS = [
  {
    key: 'xiaohongshu',
    name: '小红书',
    emoji: '📕',
    color: '#ff2442',
    search: 'https://www.xiaohongshu.com/search_result?keyword=KEY',
  },
  {
    key: 'douyin',
    name: '抖音',
    emoji: '🎵',
    color: '#000000',
    search: 'https://www.douyin.com/search/KEY',
  },
  {
    key: 'bilibili',
    name: 'B站',
    emoji: '📺',
    color: '#fb7299',
    search: 'https://search.bilibili.com/all?keyword=KEY',
  },
  {
    key: 'weibo',
    name: '微博',
    emoji: '🌐',
    color: '#e6162d',
    search: 'https://s.weibo.com/weibo?q=KEY',
  },
  {
    key: 'zhihu',
    name: '知乎',
    emoji: '🔵',
    color: '#0084ff',
    search: 'https://www.zhihu.com/search?type=content&q=KEY',
  },
  {
    key: 'youtube',
    name: 'YouTube',
    emoji: '▶️',
    color: '#ff0000',
    search: 'https://www.youtube.com/results?search_query=KEY',
  },
  {
    key: 'twitter',
    name: 'Twitter/X',
    emoji: '🐦',
    color: '#1d9bf0',
    search: 'https://twitter.com/search?q=KEY',
  },
  {
    key: 'douban',
    name: '豆瓣',
    emoji: '🟢',
    color: '#2e7d32',
    search: 'https://www.douban.com/search?q=KEY',
  },
  {
    key: 'instagram',
    name: 'Instagram',
    emoji: '📷',
    color: '#c13584',
    search: 'https://www.instagram.com/explore/tags/KEY',
  },
  {
    key: 'tiktok',
    name: 'TikTok',
    emoji: '🎶',
    color: '#010101',
    search: 'https://www.tiktok.com/search?q=KEY',
  },
];

const PLATFORM_MAP = Object.fromEntries(PLATFORMS.map((p) => [p.key, p]));

export function getPlatform(key) {
  return PLATFORM_MAP[key] || null;
}

// 根据链接自动推测平台（添加时辅助填默认值）
export function detectPlatform(url = '') {
  const u = url.toLowerCase();
  if (u.includes('xiaohongshu.com') || u.includes('xhslink.com')) return 'xiaohongshu';
  if (u.includes('douyin.com') || u.includes('iesdouyin.com')) return 'douyin';
  if (u.includes('bilibili.com') || u.includes('b23.tv')) return 'bilibili';
  if (u.includes('weibo.com') || u.includes('weibo.cn')) return 'weibo';
  if (u.includes('zhihu.com')) return 'zhihu';
  if (u.includes('youtube.com') || u.includes('youtu.be')) return 'youtube';
  if (u.includes('twitter.com') || u.includes('x.com')) return 'twitter';
  if (u.includes('douban.com')) return 'douban';
  if (u.includes('instagram.com')) return 'instagram';
  if (u.includes('tiktok.com')) return 'tiktok';
  return '';
}
