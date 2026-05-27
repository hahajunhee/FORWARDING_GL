"""
SAP ZTMR0152 엑셀 다운로드 자동화 스크립트
─────────────────────────────────────────
Usage:
  python sap_crawl.py --user <id> --password <pw> --download-dir <path> [--codes <file>] [--date-from 20250301] [--date-to 20991010]

진행 상태는 --status-file 로 지정한 JSON 파일에 기록됩니다.
"""

import os, sys, json, time, shutil, argparse
from pathlib import Path

os.environ["WDM_SSL_VERIFY"] = "0"

def write_status(path: str, stage: str, progress: int, message: str, error: str = ""):
    with open(path, "w", encoding="utf-8") as f:
        json.dump({"stage": stage, "progress": progress, "message": message, "error": error, "ts": time.time()}, f, ensure_ascii=False)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--user", required=True)
    parser.add_argument("--password", required=True)
    parser.add_argument("--download-dir", required=True)
    parser.add_argument("--codes-file", default="")
    parser.add_argument("--date-from", default="20250301")
    parser.add_argument("--date-to", default="20991010")
    parser.add_argument("--status-file", default="")
    args = parser.parse_args()

    status_file = args.status_file or os.path.join(args.download_dir, "crawl_status.json")
    download_dir = args.download_dir
    Path(download_dir).mkdir(parents=True, exist_ok=True)

    booking_codes = ""
    if args.codes_file and os.path.exists(args.codes_file):
        with open(args.codes_file, "r", encoding="utf-8") as f:
            booking_codes = f.read().strip()
    else:
        booking_codes = DEFAULT_CODES

    write_status(status_file, "init", 5, "크롬 드라이버 준비 중...")

    try:
        import pyperclip
        from selenium import webdriver
        from selenium.webdriver.chrome.service import Service
        from selenium.webdriver.common.by import By
        from selenium.webdriver.support.ui import WebDriverWait
        from selenium.webdriver.support import expected_conditions as EC
        from selenium.webdriver.common.action_chains import ActionChains
        from selenium.webdriver.common.keys import Keys
        from webdriver_manager.chrome import ChromeDriverManager
    except ImportError as e:
        write_status(status_file, "error", 0, "", f"필수 패키지 누락: {e}")
        sys.exit(1)

    TARGET_DRIVER = Path(r"C:\chromedriver-win64\chromedriver.exe")

    def ensure_chromedriver() -> str:
        if TARGET_DRIVER.exists():
            return str(TARGET_DRIVER)
        downloaded = ChromeDriverManager().install()
        TARGET_DRIVER.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(downloaded, TARGET_DRIVER)
        return str(TARGET_DRIVER)

    write_status(status_file, "driver", 10, "크롬 드라이버 확인 중...")
    driver_path = ensure_chromedriver()

    chrome_options = webdriver.ChromeOptions()
    chrome_options.add_argument("--auto-grant-permissions")
    chrome_options.add_experimental_option("prefs", {
        "profile.default_content_setting_values.clipboard": 1,
        "download.default_directory": download_dir,
        "download.prompt_for_download": False,
        "download.directory_upgrade": True,
    })

    write_status(status_file, "browser", 15, "브라우저 시작 중...")
    service = Service(driver_path)
    driver = webdriver.Chrome(service=service, options=chrome_options)

    try:
        driver.execute_cdp_cmd("Browser.grantPermissions", {
            "origin": "https://glove-tm.glovis.net",
            "permissions": ["clipboard-write"]
        })
    except Exception:
        pass

    try:
        write_status(status_file, "navigate", 20, "SAP 페이지 접속 중...")
        driver.get("https://glove-tm.glovis.net/sap/bc/ui2/flp#ZTMR0152-manage")
        time.sleep(2)

        if driver.current_url.startswith("data:"):
            driver.get("https://glove-tm.glovis.net/sap/bc/ui2/flp#ZTMR0152-manage")
            time.sleep(2)

        write_status(status_file, "login", 30, "로그인 중...")
        username_field = WebDriverWait(driver, 30).until(
            EC.presence_of_element_located((By.ID, "USERNAME_FIELD-inner"))
        )
        username_field.clear()
        username_field.send_keys(args.user)

        password_field = WebDriverWait(driver, 30).until(
            EC.presence_of_element_located((By.ID, "PASSWORD_FIELD-inner"))
        )
        password_field.clear()
        password_field.send_keys(args.password)

        login_button = WebDriverWait(driver, 30).until(
            EC.element_to_be_clickable((By.ID, "LOGIN_LINK2"))
        )
        login_button.click()

        write_status(status_file, "iframe", 40, "화면 로딩 대기 중...")
        WebDriverWait(driver, 20).until(
            EC.presence_of_element_located((By.ID, "application-ZTMR0152-manage"))
        )
        driver.switch_to.frame("application-ZTMR0152-manage")

        write_status(status_file, "filter", 50, "날짜 필터 입력 중...")
        date_low = WebDriverWait(driver, 30).until(
            EC.presence_of_element_located((By.ID, "M0:46:::7:34"))
        )
        date_low.clear()
        date_low.send_keys(args.date_from)

        date_high = WebDriverWait(driver, 30).until(
            EC.presence_of_element_located((By.ID, "M0:46:::7:59"))
        )
        date_high.clear()
        date_high.send_keys(args.date_to)

        write_status(status_file, "multiselect", 55, "다중선택 입력 중...")
        multi_btn = WebDriverWait(driver, 30).until(
            EC.element_to_be_clickable((By.ID, "M0:46:::2:78"))
        )
        multi_btn.click()
        driver.switch_to.default_content()

        pyperclip.copy(booking_codes)

        upload_found = False
        iframes = driver.find_elements(By.TAG_NAME, "iframe")
        for iframe in iframes:
            driver.switch_to.frame(iframe)
            try:
                upload_btn = WebDriverWait(driver, 20).until(
                    EC.element_to_be_clickable((By.ID, "M1:48::btn[24]"))
                )
                upload_btn.click()
                upload_found = True
                break
            except Exception:
                driver.switch_to.default_content()
                continue

        if not upload_found:
            write_status(status_file, "error", 0, "", "Upload from Clipboard 버튼을 찾지 못했습니다.")
            driver.quit()
            sys.exit(1)

        driver.switch_to.default_content()

        write_status(status_file, "search", 65, "데이터 조회 중 (F8)...")
        actions = ActionChains(driver)
        for _ in range(2):
            time.sleep(1)
            actions.send_keys(Keys.F8).perform()
            time.sleep(1)

        write_status(status_file, "export", 75, "엑셀 내보내기 중...")
        export_found = False
        iframes = driver.find_elements(By.TAG_NAME, "iframe")
        for iframe in iframes:
            try:
                driver.switch_to.frame(iframe)
                export_btn = WebDriverWait(driver, 40).until(
                    EC.element_to_be_clickable((By.ID, "_MB_EXPORT105"))
                )
                driver.execute_script("arguments[0].scrollIntoView(true);", export_btn)
                time.sleep(1)
                export_btn.click()

                spreadsheet = WebDriverWait(driver, 20).until(
                    EC.element_to_be_clickable((By.XPATH, "//*[contains(text(), 'Spreadsheet')]"))
                )
                driver.execute_script("arguments[0].scrollIntoView(true);", spreadsheet)
                time.sleep(1)
                spreadsheet.click()
                export_found = True
                break
            except Exception:
                driver.switch_to.default_content()
                continue

        if not export_found:
            write_status(status_file, "error", 0, "", "Export 버튼을 찾지 못했습니다.")
            driver.quit()
            sys.exit(1)

        driver.switch_to.default_content()

        write_status(status_file, "confirm", 85, "다운로드 확인 중...")
        try:
            driver.switch_to.frame("application-ZTMR0152-manage")
            ok_btn = WebDriverWait(driver, 20).until(
                EC.element_to_be_clickable((By.ID, "UpDownDialogChoose"))
            )
            driver.execute_script("arguments[0].scrollIntoView(true);", ok_btn)
            time.sleep(1)
            ok_btn.click()
            time.sleep(3)
        except Exception:
            pass
        finally:
            driver.switch_to.default_content()

        write_status(status_file, "waiting", 90, "파일 다운로드 대기 중...")
        deadline = time.time() + 60
        downloaded_file = None
        while time.time() < deadline:
            files = list(Path(download_dir).glob("*.xls*"))
            files = [f for f in files if not f.name.endswith(".crdownload") and not f.name.endswith(".tmp")]
            if files:
                downloaded_file = str(max(files, key=lambda f: f.stat().st_mtime))
                break
            time.sleep(2)

        if downloaded_file:
            write_status(status_file, "done", 100, f"다운로드 완료: {os.path.basename(downloaded_file)}")
            result = {"success": True, "file": downloaded_file, "filename": os.path.basename(downloaded_file)}
            result_path = os.path.join(download_dir, "crawl_result.json")
            with open(result_path, "w", encoding="utf-8") as f:
                json.dump(result, f, ensure_ascii=False)
        else:
            write_status(status_file, "error", 0, "", "다운로드 시간 초과 (60초)")

    except Exception as e:
        write_status(status_file, "error", 0, "", str(e))
        raise
    finally:
        time.sleep(2)
        driver.quit()


DEFAULT_CODES = """B00MAL
B28AMI
B28VMI
B28AMM
B28VMD
B28AMP
B06AMC
B06VMC
B28AMU
B28VMF
B28AMH
B28AMN
B28VMC
B28VMH
B28AJZ
B28AMZ
B28VJH
B28VMZ
B28AMX
B28VMX
B28AMQ
B28VME
B28AMA
B28VMB
B00AAK
B00AAW
B00AAX
B00ABX
B00VAK
B00VAW
B00VAX
B00AAN
B00VAR
B28AMG
B28AML
B28VMA
B28VML
B28AMJ
B28VMJ
B28AMS
B28VMS
B06AMV
B06VMV
B06AMW
B06VMW
B06AMT
B06VMT
B28AMB
B06VMZ
B06AMZ

B06AMH"""


if __name__ == "__main__":
    main()
