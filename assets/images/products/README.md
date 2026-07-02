# 商品圖片目錄 v2：單一主圖制

此版本依照 `data/products.json` 的 18 件商品建立資料夾，並維持原本的商品 ID 結構。

## 放置位置

請將本壓縮檔中的 `products` 資料夾內容，放入專案既有位置：

```text
assets/images/products/
```

不要建立第二層 `assets`。

## 每個商品資料夾

```text
prod-001/
├─ .gitkeep
└─ product-info.json
```

圖片完成後放入：

```text
prod-001/
├─ main.webp
└─ product-info.json
```

## 統一圖片規格

- 每個商品只使用一張圖片：`main.webp`
- 比例：4:3
- 建議尺寸：1200 × 900
- 格式：WebP
- 主體：單一商品完整呈現
- 背景：接近網站底色的米白、暖灰留白
- 不使用多視角、複雜情境、文字、價格、浮水印或品牌 Logo

## 目前狀態

- 已建立 18 個商品資料夾
- 已保留商品 ID、品牌與商品名稱
- 未建立實際圖片
- 未修改 `data/products.json`
- 未修改 HTML、CSS 或 JavaScript
