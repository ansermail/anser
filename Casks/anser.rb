cask "anser" do
  arch arm: "aarch64", intel: "x86_64"

  version "0.1.25"
  sha256 arm:   "b91df94ba2b612b054b168ce51d9ef0d7e7bfed4f205d858ad704609e98a972e",
         intel: "cb9cf366cd035cfe2bb140e5b6adaabc70a0f5e98a9f9c939c6f76c9bc7d64f9"

  url "https://github.com/ansermail/anser/releases/download/v#{version}/Anser_#{version}_#{arch}.dmg"
  name "Anser (雁信)"
  desc "Multi-account email client with local mail archiving"
  homepage "https://github.com/ansermail/anser"

  auto_updates true
  depends_on macos: :monterey

  app "雁信.app"
end
