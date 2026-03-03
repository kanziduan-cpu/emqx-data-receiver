// 引入 Supabase 客户端
import { createClient } from '@supabase/supabase-js';

// 替换为你的 Supabase 项目信息
const SUPABASE_URL = "https://siijhdpercgucgqmtfhn.supabase.co";
const SUPABASE_KEY = "sb_publishable__WzuvLboqbePaYQxEhN7Iw_b1I9";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: '仅支持 POST 请求' });
  }

  try {
    const data = req.body;
    if (!data.device_id || !data.temp || !data.hum) {
      return res.status(400).json({ error: '缺少必要字段' });
    }

    const { error } = await supabase
      .from('sensor_data')
      .insert([{
        device_id: data.device_id,
        temp: data.temp,
        hum: data.hum,
        co: data.co || 0,
        formaldehyde: data.formaldehyde || 0,
        co2: data.co2 || 0,
        aqi: data.aqi || 0
      }]);

    if (error) throw error;
    res.status(200).json({ message: '数据存储成功' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: '存储失败', detail: error.message });
  }
}
