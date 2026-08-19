from modelscope import snapshot_download

# # 指定你要存放模型的本地文件夹路径
# my_local_dir = 'D:/data/my_models'  # 这里改成你想要的路径

# # 模型会下载到 D:/my_models/bge-small-zh-v1.5
# model_dir = snapshot_download('BAAI/bge-small-zh-v1.5', cache_dir=my_local_dir)

# print(f"模型已下载到: {model_dir}")

from sentence_transformers import SentenceTransformer

# 加载本地模型
model = SentenceTransformer(r"D:\code\vksummary\backend\app\embeding_model\BAAI--bge-small-zh-v1.5")

# 文本向量化
embeddings = model.encode(["你好，世界"])
print(embeddings.shape)  # 输出: (1, 384)