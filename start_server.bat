@echo off
cd /d "C:\Users\SP59\Dropbox\sapyoung_interactive_book_list\backend"
"C:\Users\SP59\AppData\Local\Programs\Python\Python314\python.exe" -m uvicorn main:app --host 0.0.0.0 --port 8000
