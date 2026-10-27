VENV := backend/.venv
VENV_PY := .venv/bin/python
PY := $(VENV)/bin/python

.PHONY: install dev test de421 doctor docker clean

$(PY):
	python3 -m venv $(VENV)

# Asenna riippuvuudet venviin (luo sen tarvittaessa)
install: $(PY)
	$(PY) -m pip install --upgrade pip
	$(PY) -m pip install -r backend/requirements.txt

# Lataa Skyfield-efemeridi valmiiksi
de421: install
	$(PY) -c "from skyfield.api import load; load('de421.bsp')"

# Käynnistys venvin omalla Pythonilla -> ei riipu järjestelmän uvicornista
dev: install
	cd backend && $(VENV_PY) -m uvicorn app.main:app --reload --port 8000

test: install
	cd backend && $(VENV_PY) -m pytest -q

# Diagnostiikka: mistä Pythonista ja paketeista on kyse
doctor:
	@echo "venv:   $(VENV)"
	@echo "python: $$($(PY) -c 'import sys; print(sys.executable)')"
	@$(PY) -c "import fastapi, httpx, skyfield; print('fastapi', fastapi.__version__)"

docker:
	docker compose up --build

clean:
	rm -rf $(VENV) backend/.pytest_cache
