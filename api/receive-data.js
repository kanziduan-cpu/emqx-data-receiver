// 引入 Supabase 客户端（适配国内网络）
import { createClient } from '@supabase/supabase-js';
// 引入重试库，应对国内网络波动（如果安装失败可临时注释，先保证基础功能）
import retry from 'p-retry';

// ========== 请确认以下2个参数是你自己的 Supabase 信息 ==========
const SUPABASE_URL = "https://siijhdpercgucgqmtfhn.supabase.co";
// 注意：这里建议用 Supabase 的 anon key（不是 publishable key），否则可能权限不足
const SUPABASE_KEY = "sb_publishable__WzuvLboqbePaYQxEhN7Iw_b1I9";

// 配置 Supabase 客户端（核心：适配国内网络）
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  global: {
    // 自定义 fetch 请求，解决国内访问海外超时问题
    fetch: async (url, options = {}) => {
      // 设置15秒超时（国内访问Supabase默认超时短）
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);
      
      // 适配国内网络的请求头，避免被CDN/防火墙拦截
      const modifiedOptions = {
        ...options,
        signal: controller.signal,
        headers: {
          ...options.headers,
          'Content-Type': 'application/json',
          // 增加国内兼容的请求头
          'Accept': 'application/json',
          'Connection': 'keep-alive',
        },
      };

      try {
        const response = await fetch(url, modifiedOptions);
        clearTimeout(timeoutId);
        return response;
      } catch (error) {
        clearTimeout(timeoutId);
        throw error;
      }
    },
  },
  // 数据库请求超时配置
  db: {
    timeout: 15000,
  },
});

// Vercel/Netlify 云函数主入口
export default async function handler(req, res) {
  // 解决跨域问题（国内访问必加，否则EMQX请求会被拦截）
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // 仅允许 POST 请求（EMQX 转发数据用POST）
  if (req.method !== 'POST') {
    return res.status(405).json({ 
      error: '仅支持 POST 请求',
      tip: 'EMQX 需配置 POST 方式转发数据'
    });
  }

  try {
    // 处理空数据情况（避免req.body为undefined）
    const data = req.body || {};
    // 严格校验必要字段（避免脏数据）
    if (!data.device_id || typeof data.device_id !== 'string' ||
        !data.temp || isNaN(Number(data.temp)) ||
        !data.hum || isNaN(Number(data.hum))) {
      return res.status(400).json({ 
        error: '缺少必要字段或字段格式错误',
        require: { 
          device_id: '字符串（设备ID）', 
          temp: '数字（温度）', 
          hum: '数字（湿度）' 
        },
        received: data // 返回收到的数据，方便排查
      });
    }

    // 封装数据库插入逻辑，增加重试机制
    const insertToSupabase = async () => {
      const { error } = await supabase
        .from('sensor_data') // 确认你的 Supabase 表名是这个
        .insert([{
          device_id: data.device_id.trim(), // 去除空格
          temp: Number(data.temp),          // 确保数字格式
          hum: Number(data.hum),
          co: Number(data.co) || 0,         // 可选字段，默认0
          formaldehyde: Number(data.formaldehyde) || 0,
          co2: Number(data.co2) || 0,
          aqi: Number(data.aqi) || 0,
          created_at: new Date().toISOString() // 新增时间字段，方便排查数据
        }]);
      
      if (error) throw new Error(`Supabase插入失败: ${error.message}`);
    };

    // 重试机制：最多重试3次，每次间隔1秒（解决国内网络抖动）
    await retry(insertToSupabase, {
      retries: 3,
      minTimeout: 1000,
      onFailedAttempt: (error) => {
        console.warn(`第 ${error.attemptNumber} 次重试失败: ${error.message}`);
      },
    });

    // 响应成功
    res.status(200).json({ 
      message: '数据存储成功', 
      device_id: data.device_id,
      timestamp: new Date().toLocaleString('zh-CN') // 国内时间格式，方便查看
    });
  } catch (error) {
    console.error('完整错误日志:', error);
    // 区分错误类型，方便排查
    if (error.name === 'AbortError') {
      return res.status(504).json({ 
        error: '请求超时（国内访问Supabase超时）',
        tip: '建议改用国内数据库或Cloudflare代理Supabase'
      });
    }
    if (error.retriesLeft === 0) {
      return res.status(500).json({ 
        error: '重试3次后仍存储失败', 
        detail: error.message 
      });
    }
    res.status(500).json({ 
      error: '数据存储失败', 
      detail: error.message 
    });
  }
}
