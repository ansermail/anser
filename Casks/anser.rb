cask "anser" do
  arch arm: "aarch64", intel: "x86_64"

  version "0.1.50"
  sha256 arm:   "b57b4bed6f642129398ca3306c2a8c014bdaadde29d62c8a9b27b9e8e24c130a",
         intel: "13f6dbd55c5dac9e8ff6d6305296c68a0fba4172b1bc97591f76d90aae6687db"

  url "https://github.com/ansermail/anser/releases/download/v#{version}/Anser_#{version}_#{arch}.dmg"
  name "Anser (雁信)"
  desc "Multi-account email client with local mail archiving"
  homepage "https://github.com/ansermail/anser"

  auto_updates true
  depends_on macos: :monterey

  app "雁信.app"
end
