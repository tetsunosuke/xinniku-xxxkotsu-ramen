/**
 * 澱みのスープ — App Utils
 * iframe内の仮想アプリから親OSへメッセージを送信するための共通ユーティリティ
 */

// 親OS（os-core.js）へ安全にメッセージを送信するラッパー関数
function post(type, data) {
  if (window.parent !== window) {
    window.parent.postMessage(Object.assign({ type }, data), '*');
  }
}
