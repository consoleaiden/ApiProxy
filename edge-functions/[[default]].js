/**
 * 多级 catch-all 路由 —— 兼容 https://<域名>/任意路径?url=<源站> 的调用方式
 * 例如 /proxy?url=... 、/api?url=... 均可转发
 */
export { default } from './_lib.js';
