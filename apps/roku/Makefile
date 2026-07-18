.PHONY: validate package deploy

validate:
	cd ../.. && npm run roku:test && npm run roku:check

package: validate
	./package.sh

deploy: package
	./deploy-dev.sh "$${ROKU_IP}"
