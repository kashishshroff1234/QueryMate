import httpx, os
from openai import OpenAI
http_client = httpx.Client(verify=False)
client = OpenAI(base_url='https://genailab.tcs.in', api_key='sk-nI7gzS42yqwx1gsgO1KTdg', http_client=http_client)
r = client.chat.completions.create(model='azure_ai/genailab-maas-DeepSeek-V3-0324', messages=[{'role':'user','content':'say hi'}])
print(r.choices[0].message.content)